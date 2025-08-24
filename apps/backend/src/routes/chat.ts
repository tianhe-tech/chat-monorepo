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
} from 'ai'
import { consola } from 'consola'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertMessages, type MastraMessageV2 } from '@mastra/core'

import authMiddleware from '../middlewares/auth.ts'
import mcpManagerMiddleware from '../middlewares/mcp-manager.ts'
import { modelProviderRegistry } from '../config/index.ts'
import { e } from '../utils/http.ts'
import { mastra } from '../mastra/index.ts'
import { chatbotMemory } from '../mastra/memories/chatbot.ts'

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

      const modelMessages = await (async function () {
        // 无 threadId，非持久化聊天
        if (!threadId) {
          return toModelMessages(uiMessages)
        }

        const thread = await chatbotMemory.getThreadById({
          threadId,
        })
        if (!thread) {
          await chatbotMemory.createThread({ threadId, resourceId, saveThread: true })
          return toModelMessages(uiMessages)
        }

        await chatbotMemory.saveMessages({
          messages: toDBMessages(uiMessages),
        })
        const { messagesV2 } = await chatbotMemory.query({
          threadId,
          resourceId,
          threadConfig: { lastMessages: 10, semanticRecall: true },
        })

        return toModelMessages(messagesV2)
      })()

      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          onError(err) {
            consola.error('Error occurred while streaming:', err)
            const message = err instanceof Error ? err.message : String(err)
            return message
          },
          async execute({ writer }) {
            const webSearchMessages = await (async function () {
              if (isWebSearchEnabled === false) {
                return []
              }

              const webSearchStream = await mastra.getAgent('webSearchAgent').streamVNext(modelMessages, {
                format: 'aisdk',
                stopWhen: stepCountIs(1),
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
              writer.merge(webSearchStream.toUIMessageStream({ sendFinish: false }))

              const messages = (await webSearchStream.response).messages as ModelMessage[]
              console.dir(messages, { depth: Infinity })

              return messages
            })()

            writer.merge(
              streamText({
                model,
                messages: [...modelMessages, ...webSearchMessages],
                abortSignal: c.req.raw.signal,
                frequencyPenalty: config.frequencyPenalty,
                presencePenalty: config.presencePenalty,
                maxOutputTokens: config.maxOutputTokens,
                temperature: config.temperature,
                topP: config.topP,
                topK: config.topK,
              }).toUIMessageStream({ sendReasoning: true, sendStart: !isWebSearchEnabled }),
            )
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
