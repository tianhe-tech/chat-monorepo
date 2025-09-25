import { createDeepSeek } from '@ai-sdk/deepseek'
import { zValidator } from '@hono/zod-validator'
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js'
import {
  abortedToolDataSchema,
  progressDataSchema,
  threadTitleDataSchema,
  type ToolConfirmInput,
} from '@repo/shared/ai'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  validateUIMessages,
} from 'ai'

import { formatDBErrorMessage } from '@repo/shared/db'
import { consola } from 'consola'
import { eq } from 'drizzle-orm'
import { goTryRaw } from 'go-go-try'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import assert from 'node:assert'
import { AsyncLocalStorage } from 'node:async_hooks'
import { ofetch } from 'ofetch'
import { z } from 'zod'
import { convertMCPToolToAITool } from '../ai/tool'
import type { MyUIMessage } from '../ai/types'
import { chatALS, useChatALS, type ChatContext } from '../context/chat-als'
import { db } from '../db'
import * as dbSchema from '../db/schema'
import { env } from '../env'
import mcpMiddleware from '../middlewares/mcp'
import streamFinishMiddleware from '../middlewares/stream-finish'
import { inspect } from 'node:util'

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
  streamFinishMiddleware,
  mcpMiddleware,
  async (c) => {
    const user = c.get('user')
    const body = c.req.valid('json')
    const logger = consola.withTag(`Chat App ${body.threadId}`)

    const [validationErr, validatedMessages] = await goTryRaw(
      validateUIMessages<MyUIMessage>({
        messages: body.messages,
        dataSchemas: dataPartSchemas,
      }),
    )

    if (validationErr) {
      logger.error('Invalid ui messages', validationErr)
      throw new HTTPException(400, { message: 'Invalid messages' })
    }

    const inputMessage = validatedMessages[0]
    const { threadId } = body

    async function processMessages(): Promise<MyUIMessage[]> {
      logger.debug('Querying thread messages from db...')
      const [threadQueryErr, dbThread] = await goTryRaw(
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
      )

      if (threadQueryErr) {
        logger.error(formatDBErrorMessage(threadQueryErr))
        throw new HTTPException(500)
      }

      if (!dbThread) {
        const [err] = await goTryRaw(
          db.insert(dbSchema.thread).values({ id: threadId, userId: user.id, scope: user.scope }),
        )
        if (err) {
          logger.error(formatDBErrorMessage(err))
          throw new HTTPException(500)
        }
      }

      const persistedMessages: MyUIMessage[] =
        dbThread?.messages.map((message) => ({ id: message.id, parts: message.content, role: message.role })) ?? []

      const lastPersistedMessage = persistedMessages.at(-1)
      const lastMessageUpdated = lastPersistedMessage && inputMessage.id === lastPersistedMessage.id

      // lift up for readability
      async function thisIsReturn() {
        logger.debug('Saving new message to db...')
        const [err] = await goTryRaw(
          () =>
            lastMessageUpdated &&
            db
              .update(dbSchema.message)
              .set({ content: inputMessage.parts })
              .where(eq(dbSchema.message.id, inputMessage.id)),
        )

        if (err) {
          logger.error(formatDBErrorMessage(err))
          throw new HTTPException(500)
        }
        logger.debug('Saved message to db successfully')

        const oldMessages = lastMessageUpdated ? persistedMessages.slice(0, -1) : persistedMessages
        return [...oldMessages, inputMessage]
      }

      if (!lastMessageUpdated) {
        return thisIsReturn()
      }

      inputMessage.parts = await Promise.all(
        inputMessage.parts.map(async (part) => {
          if (part.type !== 'dynamic-tool') {
            return part
          }
          if (part.state !== 'input-available') {
            return part
          }
          const { _confirm } = part.input as ToolConfirmInput
          if (!_confirm) {
            logger.warn('Invalid tool state: input-available but no _confirm field')
            return part
          }

          const { onMCPEvent, sendElicitationResult } = c.get('mcpContext')
          const subCount = await sendElicitationResult({ action: _confirm })
          if (subCount === 0) {
            logger.error('Elicitation result is not handled')
            return {
              ...part,
              state: 'output-error',
              errorText: 'Internal Tool state error',
            }
          }

          return new Promise((resolve, reject) => {
            onMCPEvent(
              'toolCallResult',
              AsyncLocalStorage.bind(({ content, isError, progressToken }) => {
                setTimeout(() => {
                  reject(new Error('Tool call result timed out'))
                }, 10_000)

                const { writer } = useChatALS()

                if (progressToken !== part.toolCallId) {
                  logger.warn(`Mismatched tool call id: expected ${part.toolCallId} but got ${progressToken}`)
                  const errorText = 'Internal Tool state error'
                  writer?.write({
                    type: 'tool-output-error',
                    toolCallId: part.toolCallId,
                    dynamic: true,
                    errorText,
                  })
                  return resolve({
                    ...part,
                    state: 'output-error',
                    errorText,
                  })
                }

                const [err, result] = goTryRaw(() =>
                  content.map((c) => {
                    assert.ok(c.type === 'text')
                    return c.text
                  }),
                )

                if (err) {
                  logger.error(err)
                  return reject(err)
                }

                if (isError) {
                  const errorText = result.join('\n')
                  writer?.write({
                    type: 'tool-output-error',
                    toolCallId: part.toolCallId,
                    dynamic: true,
                    errorText,
                  })
                  return resolve({
                    ...part,
                    state: 'output-error',
                    errorText,
                  })
                }

                resolve({
                  ...part,
                  state: 'output-available',
                  output: result,
                })
              }),
            )
          })
        }),
      )

      return thisIsReturn()
    }

    const abortController = new AbortController()
    const signal = AbortSignal.any([c.req.raw.signal, abortController.signal])

    const mcpTools = await (async () => {
      logger.debug('Fetching tools from MCP service...')
      const [err, toolDefs = {}] = await goTryRaw(
        ofetch<Record<string, MCPTool[]>>('/tools', {
          baseURL: env.MCP_SERVICE_URL,
          signal,
          headers: {
            'mcp-thread-id': threadId,
          },
        }),
      )

      if (err) {
        logger.error('Failed to fetch tools from MCP service', err)
      }

      return Object.entries(toolDefs)
        .flatMap(([serverName, tools]) => tools.map((tool) => ({ ...tool, name: `${serverName}_${tool.name}` })))
        .map(convertMCPToolToAITool)
    })()

    const { setupMCPEventHandlers } = c.get('mcpContext')

    const context: ChatContext = {
      signal,
      threadId,
      model,
      mcpTools,
      abort: () => abortController.abort(),
    }

    return chatALS.run(context, async () => {
      setupMCPEventHandlers()
      const uiMessages = await processMessages()

      logger.box(
        inspect(
          {
            uiMessages,
          },
          { depth: Infinity },
        ),
      )

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
            context.writer = writer

            const stream = streamText({
              model,
              messages: convertToModelMessages(uiMessages),
              tools: Object.fromEntries(mcpTools),

              stopWhen: stepCountIs(5),
              abortSignal: signal,
            })

            writer.merge(stream.toUIMessageStream({ sendStart: false, sendFinish: false }))
          },
          async onFinish({ messages }) {
            logger.debug('Saving assistant message to db...', inspect({ messages }, { depth: Infinity }))
            const [err] = await goTryRaw(
              Promise.all(
                messages.map(async (message) => {
                  await db.insert(dbSchema.message).values({
                    id: message.id,
                    content: message.parts,
                    threadId,
                    format: 'ai_v5',
                    role: message.role as any,
                  })
                }),
              ),
            )
            if (err) {
              logger.error(formatDBErrorMessage(err))
              throw err
            }
            logger.debug('Saved assistant message to db successfully')
          },
        }),
      })
    })
  },
)

export default chatApp
