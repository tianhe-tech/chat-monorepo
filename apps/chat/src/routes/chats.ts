import { createDeepSeek } from '@ai-sdk/deepseek'
import { zValidator } from '@hono/zod-validator'
import { abortedToolDataSchema, progressDataSchema, threadTitleDataSchema } from '@repo/shared/ai'
import { constructDBError } from '@repo/shared/utils'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  stepCountIs,
  streamText,
  validateUIMessages,
} from 'ai'
import { consola } from 'consola'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok, okAsync, ResultAsync } from 'neverthrow'
import { inspect } from 'node:util'
import { z } from 'zod'
import type { MyUIMessage } from '../ai/types'
import { db } from '../db'
import * as dbSchema from '../db/schema'
import { env } from '../env'
import { ChatMCPService } from '../ai/mcp'
import exitHook from 'exit-hook'

const model = createDeepSeek().languageModel('deepseek-chat')

const dataPartSchemas = {
  'aborted-tool': abortedToolDataSchema,
  'thread-title': threadTitleDataSchema,
  progress: progressDataSchema,
} as const

const chatApp = new Hono().post(
  '/',
  zValidator(
    'json',
    z.object({
      messages: z.tuple([z.unknown()]),
      threadId: z.string(),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const logger = consola.withTag(`Chat App ${body.threadId}`)

    const validatedMessages = await ResultAsync.fromPromise(
      validateUIMessages<MyUIMessage>({
        messages: body.messages,
        dataSchemas: dataPartSchemas,
      }),

      (err) => {
        logger.error('Invalid ui messages', err)
        return new HTTPException(400, { message: 'Invalid messages' })
      },
    )

    if (validatedMessages.isErr()) {
      throw validatedMessages.error
    }

    const inputMessage = validatedMessages.value[0]
    const { threadId } = body

    const abortController = new AbortController()
    const signal = AbortSignal.any([c.req.raw.signal, abortController.signal])

    const getPersistedMessages = () => {
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
          logger.error({ error: dbError }, message)
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
            logger.error({ error: dbError }, message)
            return err
          },
        )
      })

      return insertThreadIfNotExist.map((thread) => {
        const dbMessages = thread?.messages ?? []
        return dbMessages.map((message) => ({ id: message.id, parts: message.content, role: message.role }))
      })
    }

    const disposableStack = new AsyncDisposableStack()

    return createUIMessageStreamResponse({
      headers: {
        'Content-Type': 'text/event-stream',
      },
      stream: createUIMessageStream<MyUIMessage>({
        originalMessages: [inputMessage],
        onError(err) {
          logger.error('Error occurred while streaming:', err)
          const message = err instanceof Error ? err.message : String(err)
          return message
        },
        async execute({ writer }) {
          const createMCPService = ChatMCPService.new({
            signal,
            threadId,
            valkeyAddresses: env.VALKEY_ADDRESSES,
            abort: () => abortController.abort(),
            writer,
          }).andTee((mcpService) => exitHook(() => mcpService.close()))

          const fulfillToolElicitation = createMCPService.andThen(
            ResultAsync.fromThrowable(async (mcpService) => {
              inputMessage.parts = await Promise.all(
                inputMessage.parts.map(async (part) => {
                  if (part.type !== 'dynamic-tool') {
                    return part
                  }
                  return mcpService.fulfillToolElicitation(part)
                }),
              )
            }),
          )

          const getUpdatedMessages = getPersistedMessages().andThen((persistedMessages) =>
            fulfillToolElicitation.andThen(() => {
              const lastMessage = persistedMessages.at(-1)
              const isLastMessageUpdated = lastMessage && inputMessage.id === lastMessage.id

              if (!isLastMessageUpdated) {
                return okAsync([...persistedMessages, inputMessage])
              }
              return ResultAsync.fromPromise(
                db
                  .update(dbSchema.message)
                  .set({ content: inputMessage.parts })
                  .where(eq(dbSchema.message.id, inputMessage.id)),
                (err) => {
                  const { message, error: dbError } = constructDBError(err)
                  logger.error({ error: dbError }, message)
                  return err
                },
              ).map(() => [...persistedMessages.slice(0, -1), inputMessage])
            }),
          )

          const getMCPTools = createMCPService.andThen((mcpService) => mcpService.getTools())

          // TODO: 可细粒度配置的工具列表
          const setupSampling = createMCPService.andThen((mcpService) =>
            getMCPTools.andTee((mcpTools) => {
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
            }),
          )

          const uiMessages = await getUpdatedMessages
          if (uiMessages.isErr()) {
            throw uiMessages.error
          }

          const mcpTools = await setupSampling
          if (mcpTools.isErr()) {
            throw mcpTools.error
          }

          const stream = streamText({
            model,
            messages: convertToModelMessages(uiMessages.value),
            tools: Object.fromEntries(mcpTools.value),

            stopWhen: stepCountIs(5),
            abortSignal: signal,
          })

          writer.merge(stream.toUIMessageStream({ sendStart: false, sendFinish: false }))
        },
        async onFinish({ messages }) {
          await disposableStack.disposeAsync()

          logger.debug('Saving assistant message to db...', inspect({ messages }, { depth: Infinity }))

          const result = await ResultAsync.combine(
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
          if (result.isErr()) {
            throw result.error
          }
          logger.debug('Saved assistant message to db successfully')
        },
      }),
    })
  },
)

export default chatApp
