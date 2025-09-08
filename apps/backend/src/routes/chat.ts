import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { DataUIParts, Tools } from '@th-chat/shared/ai-sdk'
import { zValidator } from '@hono/zod-validator'
import { convertMessages } from '@mastra/core/agent'
import { type MastraMessageV2 } from '@mastra/core'
import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  getToolName,
  isToolUIPart,
  stepCountIs,
  streamText,
  validateUIMessages,
  type ModelMessage,
  type UIMessage,
} from 'ai'
import { consola } from 'consola'
import { Hono } from 'hono'
import { z } from 'zod'
import { modelProviderRegistry } from '../config/index.ts'
import { webSearchAgent, titleGenerator, slurmAgent } from '../mastra/agents/index.ts'
import { chatbotMemory } from '../mastra/memories/chatbot.ts'
import authMiddleware from '../middlewares/auth.ts'
import { HTTPException } from 'hono/http-exception'
import { slurmMcp, testTool } from '../mastra/agents/slurm.ts'

type MyUIMessage = UIMessage<never, DataUIParts, Tools>

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
        throw new HTTPException(400, { message: 'Not enough model info' })
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
              const title = await titleGenerator.generateTitleFromUserMessage({
                message: uiMessages.at(-1)!,
                tracingContext: {},
              })
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
              writer.merge(webSearchStream.toUIMessageStream<MyUIMessage>({ sendFinish: false, sendStart: false }))

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
  .post(
    '/agent',
    zValidator(
      'json',
      z.object({
        messages: z.array(z.any()),
      }),
    ),
    async (c) => {
      const messages = await validateUIMessages<MyUIMessage>({ messages: c.req.valid('json').messages })

      return createUIMessageStreamResponse({
        consumeSseStream: consumeStream,
        stream: createUIMessageStream<MyUIMessage>({
          onError(err) {
            consola.error('Error occurred while streaming:', err)
            const message = err instanceof Error ? err.message : String(err)
            return message
          },
          async execute({ writer }) {
            const lastMessage = messages.at(-1)!

            const controller = new AbortController()

            slurmMcp.elicitation.onRequest('slurm', async (_request) => {
              controller.abort()
              writer.write({ type: 'finish-step' })
              writer.write({ type: 'abort' })

              const action = (await submitSlurmJobPromise) as 'accept' | 'decline' | 'cancel'

              submitSlurmJobPromise = new Promise<string>((resolve, reject) => {
                submitSlurmJob.resolve = resolve
                submitSlurmJob.reject = reject
              })

              return {
                action,
              }
            })

            //@ts-ignore
            lastMessage.parts = await Promise.all(
              lastMessage.parts.map(async (part) => {
                if (!isToolUIPart(part)) {
                  return part
                }
                const toolName = getToolName(part)
                console.log(part.state)
                if (
                  (toolName !== 'testTool' &&
                    //@ts-ignore
                    toolName !== 'slurm_submit_slurm_job') ||
                  part.state !== 'input-available'
                ) {
                  return part
                }

                console.log(part)

                // @ts-ignore
                const _confirm = part.input?._confirm
                if (_confirm && toolName === 'slurm_submit_slurm_job') {
                  submitSlurmJob.resolve(_confirm)
                  return part
                }
                //@ts-ignore
                const result = await testTool.execute?.({ context: { _confirm } })
                writer.write({ type: 'tool-output-available', toolCallId: part.toolCallId, output: result })
                return { ...part, state: 'output-available', output: result }
              }),
            )

            const stream = await slurmAgent.streamVNext(messages, {
              format: 'aisdk',
              options: {
                abortSignal: controller.signal,
              },
            })

            writer.merge(stream.toUIMessageStream({ sendStart: false, sendFinish: false, sendReasoning: true }))
          },
        }),
      })
    },
  )

const submitSlurmJob: { resolve: (val: any) => void; reject: (reason?: any) => void } = {
  resolve: () => {},
  reject: () => {},
}

let submitSlurmJobPromise = new Promise<string>((resolve, reject) => {
  submitSlurmJob.resolve = resolve
  submitSlurmJob.reject = reject
})

export default chatApp
