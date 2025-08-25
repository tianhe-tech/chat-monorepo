import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  createUIMessageStream,
  streamText,
  createUIMessageStreamResponse,
  validateUIMessages,
  stepCountIs,
  type ModelMessage,
  type UIMessage,
} from 'ai'
import { consola } from 'consola'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertMessages, type MastraMessageV2 } from '@mastra/core'
import type { DataUIParts } from '@chat-monorepo/shared/ai-sdk'

import authMiddleware from '../middlewares/auth.ts'
import mcpManagerMiddleware from '../middlewares/mcp-manager.ts'
import { modelProviderRegistry } from '../config/index.ts'
import { e } from '../utils/http.ts'
import { chatbotMemory } from '../mastra/memories/chatbot.ts'
import { webSearchAgent } from '../mastra/agents/web-search.ts'
import { titleGenerator } from '../mastra/agents/title-generator.ts'

type MyUIMessage = UIMessage<never, DataUIParts>

const configSchema = z.object({
  baseURL: z.string().url().optional(),
  apiKey: z.string().optional(),
  modelProvider: z.enum(['one-api']).optional(),
  model: z.string(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().min(1).max(100).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  maxOutputTokens: z.number().int().optional(),
})

const chatApp = new Hono()
  .use(authMiddleware)
  .use(mcpManagerMiddleware)
  .post(
    '/',
    zValidator(
      'json',
      configSchema.extend({
        threadId: z.string().optional(),
        messages: z.array(z.any()),
        webSearch: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const { threadId, messages, webSearch: isWebSearchEnabled, ...config } = c.req.valid('json')
      const resourceId = c.get('userId')

      const model = (function () {
        if (config.modelProvider) {
          return modelProviderRegistry.languageModel(`${config.modelProvider}:${config.model}`)
        }
        if (config.baseURL) {
          const provider = createOpenAICompatible({
            name: 'openai-compatible',
            baseURL: config.baseURL,
            apiKey: config.apiKey,
          })
          return provider.languageModel(config.model)
        }
        return undefined
      })()

      if (model === undefined) {
        return c.json(e('Not enough model info'), 400)
      }

      const uiMessages = await validateUIMessages({ messages })

      function toDBMessages(messages: Parameters<typeof convertMessages>[0]): MastraMessageV2[] {
        return convertMessages(messages)
          .to('Mastra.V2')
          .map((message) => ({ ...message, threadId, resourceId }))
      }
      function toModelMessages(messages: Parameters<typeof convertMessages>[0]): ModelMessage[] {
        return convertMessages(messages).to('AIV5.Model')
      }

      const [modelMessages, isNewThread] = await (async function () {
        let isNewThread = false
        // 无 threadId，非持久化聊天
        if (!threadId) {
          return [toModelMessages(uiMessages), isNewThread]
        }

        const thread = await chatbotMemory.getThreadById({
          threadId,
        })
        if (!thread) {
          await chatbotMemory.createThread({ threadId, resourceId, saveThread: true, title: 'New Thread' })
          isNewThread = true
        }

        await chatbotMemory.saveMessages({
          messages: toDBMessages(uiMessages),
        })
        const { messagesV2 } = await chatbotMemory.query({
          threadId,
          resourceId,
          threadConfig: { lastMessages: 10, semanticRecall: true },
        })

        return [toModelMessages(messagesV2), isNewThread]
      })()

      return createUIMessageStreamResponse({
        stream: createUIMessageStream<MyUIMessage>({
          onError(err) {
            consola.error('Error occurred while streaming:', err)
            const message = err instanceof Error ? err.message : String(err)
            return message
          },
          async execute({ writer }) {
            writer.write({ type: 'start' })

            // await at the end
            const titlePromise = (async function () {
              if (!isNewThread || !threadId || uiMessages.length === 0) {
                return
              }
              const title = await titleGenerator.generateTitleFromUserMessage({ message: uiMessages.at(-1)! })
              await chatbotMemory.updateThread({ id: threadId, title, metadata: {} })
              writer.write({
                type: 'data-thread-title',
                data: {
                  title,
                },
                transient: true,
              })
            })()

            const webSearchMessages = await (async function () {
              if (isWebSearchEnabled === false) {
                return []
              }

              const webSearchStream = await webSearchAgent.streamVNext(modelMessages, {
                stopWhen: stepCountIs(1),
                format: 'aisdk',
                outputProcessors: [
                  {
                    name: 'filter-websearch-stream',
                    async processOutputStream({ part }) {
                      if (part.type.includes('tool') === false) {
                        return null
                      }
                      return part
                    },
                  },
                ],
              })
              writer.merge(webSearchStream.toUIMessageStream({ sendFinish: false, sendStart: false }))

              const messages = (await webSearchStream.response).messages as ModelMessage[]

              return messages.filter((message) => {
                if (typeof message.content === 'string') {
                  return false
                }
                return message.content.filter((part) => part.type.includes('tool')).length > 0
              })
            })()

            const chatbotStream = streamText({
              model,
              messages: [...modelMessages, ...webSearchMessages],
              abortSignal: c.req.raw.signal,
              frequencyPenalty: config.frequencyPenalty,
              presencePenalty: config.presencePenalty,
              maxOutputTokens: config.maxOutputTokens,
              temperature: config.temperature,
              topP: config.topP,
              topK: config.topK,
            })

            writer.merge(chatbotStream.toUIMessageStream({ sendReasoning: true, sendStart: false, sendFinish: false }))

            await titlePromise

            writer.write({ type: 'finish' })
          },
          async onFinish({ messages }) {
            if (threadId) {
              await chatbotMemory.saveMessages({
                messages: toDBMessages(messages),
              })
            }
          },
        }),
      })
    },
  )

export default chatApp
