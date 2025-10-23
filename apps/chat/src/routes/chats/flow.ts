import type { LanguageModelV2 } from '@ai-sdk/provider'
import { constructDBError } from '@internal/shared/utils'
import { streamText, stepCountIs, generateId, NoOutputGeneratedError, type UIMessageStreamWriter } from 'ai'
import { consola, type ConsolaInstance } from 'consola'
import { eq } from 'drizzle-orm'
import { ok, okAsync, ResultAsync } from 'neverthrow'
import { ChatMCPService } from '../../ai/mcp'
import type { MyUIMessage } from '../../ai/types'
import { db } from '../../db'
import * as dbSchema from '../../db/schema'
import assert from 'node:assert'

export type ChatsPostFlowOptions = {
  threadId: string
  user: { id: string; scope: string }
}

export class ChatsPostFlow {
  #threadId: ChatsPostFlowOptions['threadId']
  #user: ChatsPostFlowOptions['user']
  #writer?: UIMessageStreamWriter<MyUIMessage>
  #logger: ConsolaInstance

  constructor({ threadId, user }: ChatsPostFlowOptions) {
    this.#threadId = threadId
    this.#user = user
    this.#logger = consola.withTag(`ChatsPostFlow:${threadId}`)
  }

  setWriter(writer: UIMessageStreamWriter<MyUIMessage>) {
    this.#writer = writer
  }

  getPersistedMessages(): ResultAsync<MyUIMessage[], unknown> {
    const threadId = this.#threadId
    const user = this.#user

    const findThread = ResultAsync.fromPromise(
      db.query.thread.findFirst({
        where: (thread, { and, eq, isNull }) =>
          and(
            eq(thread.id, threadId),
            eq(thread.userId, user.id),
            eq(thread.scope, user.scope),
            isNull(thread.deletedAt),
          ),
        with: {
          messages: {
            orderBy: (message, { asc }) => [asc(message.createdAt)],
            where: (message, { isNull }) => isNull(message.deletedAt),
          },
        },
      }),
      (err) => {
        const { message, error: dbError } = constructDBError(err)
        this.#logger.error({ error: dbError }, message)
        return err
      },
    )

    const insertThreadIfNotExist = findThread.andThrough((thread) => {
      if (thread) {
        return ok()
      }
      return ResultAsync.fromPromise(
        db.insert(dbSchema.thread).values({ id: threadId, userId: user.id, scope: user.scope }),
        (err) => {
          const { message, error: dbError } = constructDBError(err)
          this.#logger.error({ error: dbError }, message)
          return err
        },
      )
    })

    return insertThreadIfNotExist.map((thread) => {
      const dbMessages = thread?.messages ?? []
      return dbMessages.map((message) => ({ id: message.id, parts: message.content, role: message.role }))
    })
  }

  updateNewMessage(params: { persistedMessages: MyUIMessage[]; newMessage: MyUIMessage }) {
    const { persistedMessages, newMessage } = params

    const lastMessage = persistedMessages.at(-1)
    const isLastMessageUpdated = lastMessage && newMessage.id === lastMessage.id
    if (!isLastMessageUpdated) {
      return okAsync([...persistedMessages, newMessage])
    }
    return ResultAsync.fromPromise(
      db.update(dbSchema.message).set({ content: newMessage.parts }).where(eq(dbSchema.message.id, newMessage.id)),
      (err) => {
        const { message, error: dbError } = constructDBError(err)
        this.#logger.error({ error: dbError }, message)
        return err
      },
    ).map(() => [...persistedMessages.slice(0, -1), newMessage])
  }

  setupSampling(params: { mcpService: ChatMCPService; model: LanguageModelV2; signal: AbortSignal }) {
    const { mcpService, model, signal } = params

    return mcpService.getTools().map((mcpTools) => {
      mcpService.on('samplingRequest', async ({ messages, serverName, systemPrompt, metadata }) => {
        const includedTools = (() => {
          const includedTools = metadata?.tools
          this.#logger.debug('Sampling Tools,', includedTools)
          if (!includedTools || includedTools.length === 0) {
            return []
          }
          return mcpTools.filter(
            ([toolName]) =>
              toolName.startsWith(serverName) && includedTools.some((includedTool) => toolName.endsWith(includedTool)),
          )
        })()

        const { fullStream, text } = streamText({
          model,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content.text as string,
          })),
          system: systemPrompt,
          tools: Object.fromEntries(includedTools),
          abortSignal: signal,
          stopWhen: stepCountIs(7),
        })

        try {
          for await (const chunk of fullStream) {
            switch (chunk.type) {
              case 'tool-call':
                this.#writer?.write({
                  type: 'tool-input-available',
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  input: chunk.input,
                  dynamic: chunk.dynamic,
                })
                break
              case 'tool-result':
                this.#writer?.write({
                  type: 'tool-output-available',
                  toolCallId: chunk.toolCallId,
                  output: chunk.output,
                  dynamic: chunk.dynamic,
                })
                break
              case 'tool-error':
                this.#writer?.write({
                  type: 'tool-output-error',
                  toolCallId: chunk.toolCallId,
                  dynamic: chunk.dynamic,
                  errorText: String(chunk.error),
                })
                break
              default:
                break
            }
          }
        } catch {}

        let assistantText = ''
        try {
          assistantText = await text
        } catch (error) {
          if (NoOutputGeneratedError.isInstance(error)) {
            this.#logger.warn('Sampling completed without generated text; responding with an empty assistant message.')
          } else {
            throw error
          }
        }

        await mcpService.sendSamplingResult({
          model: model.modelId,
          content: {
            type: 'text',
            text: assistantText,
          },
          role: 'assistant',
        })
      })
    })
  }

  persistMessages(params: { messages: MyUIMessage[] }) {
    const { messages } = params
    const threadId = this.#threadId
    const logger = this.#logger

    return ResultAsync.combine(
      messages.map((message) =>
        ResultAsync.fromPromise(
          db.insert(dbSchema.message).values({
            id: message.id,
            content: message.parts,
            threadId,
            format: 'ai_v5',
            role: message.role as any,
          }),
          (err) => {
            const { message, error: dbError } = constructDBError(err)
            logger.error({ error: dbError }, message)
            return err
          },
        ),
      ),
    )
  }
}
