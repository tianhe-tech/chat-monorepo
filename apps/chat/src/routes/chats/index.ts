import { createDeepSeek } from '@ai-sdk/deepseek'
import { zValidator } from '@hono/zod-validator'
import {
  abortedToolDataSchema,
  isContinuation,
  isElicitationRequest,
  progressDataSchema,
  threadTitleDataSchema,
  UIPartBrands,
} from '@repo/shared/types'
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
import assert from 'node:assert'

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
    const reqSignal = c.req.raw.signal
    const abortSignal = abortController.signal
    const signal = AbortSignal.any([reqSignal, abortSignal])

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
          flow.setWriter(writer)

          const createMCPService = ChatMCPService.new({
            signal: reqSignal,
            threadId,
            valkeyAddresses: env.VALKEY_ADDRESSES,
            abort: () => abortController.abort(),
            writer,
          }).andTee((mcpService) => {
            disposableStack.use(mcpService)
            exitHook(() => mcpService.close())

            mcpService.on('toolCallResult', ({ content, isError, _meta }) => {
              const toolCallId = _meta?.progressToken
              if (!toolCallId) {
                return
              }

              const continuationPart = inputMessage.parts.find(
                (part) => part.type === 'dynamic-tool' && part.toolCallId === toolCallId && isContinuation(part.output),
              )
              if (!continuationPart) {
                return
              }
              assert(continuationPart.type === 'dynamic-tool')

              const text = content.map((c) => ('text' in c ? c.text : '')).join('\n')

              logger.box('Output for continuation tool', text)
              if (isError) {
                continuationPart.state === 'output-error'
                continuationPart.errorText = text
                writer.write({
                  type: 'tool-output-error',
                  toolCallId: continuationPart.toolCallId,
                  dynamic: true,
                  errorText: text,
                })
              } else {
                continuationPart.state === 'output-available'
                continuationPart.output = text
                writer.write({
                  type: 'tool-output-available',
                  toolCallId: continuationPart.toolCallId,
                  dynamic: true,
                  output: text,
                })
              }
            })
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
              .andThen(() => flow.updateNewMessage({ persistedMessages, newMessage: inputMessage }))
              // 调用模型需要所有工具调用都有输出，用特殊的 Brand 标记一下
              .andTee(() => {
                for (const part of inputMessage.parts) {
                  if (
                    part.type === 'dynamic-tool' &&
                    part.state !== 'output-available' &&
                    part.state !== 'output-error'
                  ) {
                    //@ts-ignore
                    part.state = 'output-available'
                    //@ts-ignore
                    part.output = {
                      [UIPartBrands.Continuation]: true,
                    }
                  }
                }
              }),
          )

          const mcpTools = await createMCPService.andThen((mcpService) =>
            mcpService
              .getTools()
              .andTee(() => flow.setupSampling({ mcpService, model, signal }))
              .map((tools) => tools.filter(([_, tool]) => tool.category !== 'util')),
          )

          if (mcpTools.isErr()) {
            logger.error('Failed to get MCP tools', mcpTools.error)
            throw new HTTPException(500)
          }

          const uiMessages = await getUpdatedMessages
          if (uiMessages.isErr()) {
            logger.error('Failed to get updated messages', uiMessages.error)
            throw new HTTPException(500)
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

          // TODO better one
          const lastPart = messages.at(-1)?.parts.at(-1)
          if (lastPart && lastPart.type === 'dynamic-tool' && isElicitationRequest(lastPart.output)) {
            logger.debug("We don't persist elicitation request")
            messages.pop()
          }

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
