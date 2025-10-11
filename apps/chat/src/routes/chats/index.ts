import { createDeepSeek } from '@ai-sdk/deepseek'
import { zValidator } from '@hono/zod-validator'
import { abortedToolDataSchema, progressDataSchema, threadTitleDataSchema } from '@repo/shared/ai'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  validateUIMessages,
} from 'ai'
import { consola } from 'consola'
import exitHook from 'exit-hook'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { err, ok, ResultAsync } from 'neverthrow'
import { inspect } from 'node:util'
import { z } from 'zod'
import { ChatMCPService } from '../../ai/mcp'
import type { MyUIMessage } from '../../ai/types'
import { env } from '../../env'
import { ChatsPostFlow } from './flow'

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
    ).andThrough((messages) => {
      if (messages.length === 1) {
        return ok()
      }
      logger.error('Expecting exactly one message, got:', messages.length)
      return err(new HTTPException(400, { message: 'Invalid messages' }))
    })

    if (validatedMessages.isErr()) {
      throw validatedMessages.error
    }

    const inputMessage = validatedMessages.value[0]
    const { threadId } = body

    const abortController = new AbortController()
    const signal = AbortSignal.any([c.req.raw.signal, abortController.signal])

    const flow = new ChatsPostFlow({ threadId, user })

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
          }).andTee((mcpService) => {
            disposableStack.use(mcpService)
            exitHook(() => mcpService.close())
          })

          const getUpdatedMessages = flow.getPersistedMessages().andThen((persistedMessages) =>
            createMCPService
              .andThen(
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
              .andThen(() => flow.updateNewMessage({ persistedMessages, newMessage: inputMessage })),
          )

          const mcpTools = await createMCPService.andThen((mcpService) =>
            mcpService.getTools().andTee(() => flow.setupSampling({ mcpService, model, signal })),
          )

          if (mcpTools.isErr()) {
            throw mcpTools.error
          }

          const uiMessages = await getUpdatedMessages
          if (uiMessages.isErr()) {
            throw uiMessages.error
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

          const result = await flow.persistMessages({ messages })
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
