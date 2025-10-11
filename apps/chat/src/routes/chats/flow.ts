import type { LanguageModelV2 } from '@ai-sdk/provider'
import { constructDBError } from '@repo/shared/utils'
import { generateText, type DynamicToolUIPart } from 'ai'
import { consola, type ConsolaInstance } from 'consola'
import { eq } from 'drizzle-orm'
import { ok, okAsync, ResultAsync } from 'neverthrow'
import { ChatMCPService } from '../../ai/mcp'
import type { MyUIMessage } from '../../ai/types'
import { db } from '../../db'
import * as dbSchema from '../../db/schema'

export type ChatsPostFlowOptions = {
  threadId: string
  user: { id: string; scope: string }
}

export class ChatsPostFlow {
  #threadId: ChatsPostFlowOptions['threadId']
  #user: ChatsPostFlowOptions['user']
  #logger: ConsolaInstance

  constructor({ threadId, user }: ChatsPostFlowOptions) {
    this.#threadId = threadId
    this.#user = user
    this.#logger = consola.withTag(`ChatsPostFlow:${threadId}`)
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

  // TODO: 可细粒度配置的工具列表
  setupSampling(params: { mcpService: ChatMCPService; model: LanguageModelV2; signal: AbortSignal }) {
    const { mcpService, model, signal } = params

    return mcpService.getTools().map((mcpTools) => {
      mcpService.on('samplingRequest', async ({ messages, serverName, systemPrompt, includeContext }) => {
        const includedTools = (() => {
          if (includeContext === 'none') {
            return []
          }
          if (includeContext === 'allServers') {
            return mcpTools
          }
          return mcpTools.filter(([toolName, tool]) => toolName.startsWith(serverName) && !tool.isEntry)
        })()

        const { text } = await generateText({
          model,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content.text as string,
          })),
          system: systemPrompt,
          tools: Object.fromEntries(includedTools),
          abortSignal: signal,
        })

        await mcpService.sendSamplingResult({
          model: model.modelId,
          content: {
            type: 'text',
            text,
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
