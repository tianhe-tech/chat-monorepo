import type { LanguageModelV2 } from '@ai-sdk/provider'
import { qualifiedToolNameSchema, type SamplingRequest } from '@th-chat/shared/contracts/chat-mcp-hub'
import { convertToModelMessages, NoOutputGeneratedError, stepCountIs, streamText, type UIMessageStreamWriter } from 'ai'
import consola from 'consola'
import { ok, ResultAsync } from 'neverthrow'
import { Message, type UIMessageType } from '../../domain/entity/message'
import { MCPToolPartTag } from '../../domain/entity/part'
import { DomainMediator } from '../../domain/mediator'
import { MCPToolService } from '../../domain/service/mcp-tool'
import { env } from '../../app/env'
import { DrizzleThreadRepo } from '../../infra/drizzle-repository'
import { RestMCPHubAPI } from '../../infra/rest-mcp-hub-api'
import { ValkeyMCPHubComm } from '../../infra/valkey-mcp-hub-comm'

type Params = {
  userId: string
  scope: string
  threadId: string
  mcphubSignal: AbortSignal
}

export function createChatUseCase({ userId, scope, threadId, mcphubSignal }: Params) {
  const repo = new DrizzleThreadRepo({ userId, scope })
  const hubAPI = new RestMCPHubAPI({ threadId, baseURL: env.MCP_SERVICE_URL, logger: consola.withTag('MCP Hub API') })
  const toolService = new MCPToolService({ hubAPI, signal: mcphubSignal })

  const abortController = new AbortController()
  const combinedSignal = AbortSignal.any([mcphubSignal, abortController.signal])

  return {
    getThreads() {
      return repo.getThreads()
    },
    upsertMessage(message: UIMessageType) {
      return repo.upsertMessage(threadId, message)
    },
    streamChat(props: {
      newMessage: UIMessageType
      writer: UIMessageStreamWriter<UIMessageType>
      model: LanguageModelV2
    }) {
      const { newMessage, model, writer } = props
      const getMCPTools = toolService.listAllTools()

      const mediator = new DomainMediator()
      const logger = consola.withTag(`ChatUseCase:${threadId}`)
      const createMCPHubComm = ValkeyMCPHubComm.create({
        mediator,
        valkeyAddresses: env.VALKEY_ADDRESSES,
        logger: consola.withTag('MCP Hub Comm'),
      })

      return repo
        .upsertMessage(threadId, newMessage)
        .andThen(() => repo.getThreadMessages(threadId))
        .andThen((uiMessages) => {
          const message = new Message({ mediator, message: uiMessages.at(-1)!, threadId })
          mediator.on('mcpToolCallResult', ({ id, data }) => {
            if (id !== threadId) {
              return
            }
            message.resolveContinuationResult(data.toolCallId, data)
          })
          return ResultAsync.fromSafePromise(message.followupElicitationResult().then(() => message.markContinuation()))
            .andThen(() => getMCPTools)
            .orElse(() => ok([]))
            .andThen((tools) =>
              createMCPHubComm
                .map((comm) => {
                  const stream = streamText({
                    model,
                    messages: convertToModelMessages(uiMessages),
                    tools: Object.fromEntries(tools),
                    stopWhen: stepCountIs(5),
                    abortSignal: combinedSignal,
                  })

                  writer.merge(stream.toUIMessageStream({ sendStart: false, sendFinish: false }))
                  return {
                    async cleanup() {
                      mediator.removeAllListeners()
                      await message[Symbol.asyncDispose]()
                      await comm[Symbol.asyncDispose]()
                    },
                  }
                })
                .andTee(() => {
                  mediator.on('mcpToolOutputAvailable', (part) => {
                    writer.write({
                      type: 'tool-output-available',
                      toolCallId: part.toolCallId,
                      output: part.output,
                      dynamic: true,
                    })
                  })
                  mediator.on('mcpToolOutputError', (part) => {
                    writer.write({
                      type: 'tool-output-error',
                      toolCallId: part.toolCallId,
                      errorText: part.errorText ?? 'Unknown error',
                      dynamic: true,
                    })
                  })
                  mediator.on('mcpToolProgress', ({ id, data }) => {
                    if (id === threadId) {
                      return
                    }
                    writer.write({
                      type: 'data-progress',
                      id: toolService.currentToolCallId,
                      data,
                    })
                  })
                  mediator.on('mcpToolElicitationRequest', ({ id, data }) => {
                    if (id !== threadId) {
                      return
                    }
                    if (!toolService.currentToolCallId) {
                      logger.warn('No current tool call ID found for elicitation request, cancelling')
                      mediator.emit('mcpToolElicitationResult', {
                        id: threadId,
                        data: { action: 'cancel', toolCallId: data.toolCallId },
                      })
                      return
                    }
                    writer.write({
                      type: 'tool-output-available',
                      toolCallId: toolService.currentToolCallId,
                      dynamic: true,
                      output: {
                        [MCPToolPartTag.elicitationRequest]: data,
                      },
                    })
                    abortController.abort()
                  })
                  mediator.on('mcpToolSamplingRequest', (request) => {
                    if (request.id !== threadId) {
                      return
                    }

                    void (async () => {
                      const { data } = request
                      const { messages: samplingMessages = [], metadata, systemPrompt, toolCallId } = data
                      const serverName = (data as { serverName?: string }).serverName
                      const requestedTools = (metadata as { tools?: string[] } | undefined)?.tools ?? []

                      logger.debug('Sampling tools requested:', requestedTools)

                      const includedTools = (() => {
                        if (requestedTools.length === 0) {
                          return []
                        }

                        return tools.filter(([qualifiedToolName]) => {
                          const { success, data } = qualifiedToolNameSchema.safeDecode(qualifiedToolName)
                          if (!success) {
                            return false
                          }
                          return data.serverName === serverName && requestedTools.includes(data.toolName)
                        })
                      })()

                      const { fullStream, text } = streamText({
                        model,
                        messages: samplingMessages.map((message) => ({
                          role: message.role,
                          content:
                            typeof message.content === 'string'
                              ? message.content
                              : ((message.content?.text as string) ?? ''),
                        })),
                        system: systemPrompt,
                        tools: Object.fromEntries(includedTools),
                        abortSignal: combinedSignal,
                        stopWhen: stepCountIs(5),
                      })

                      try {
                        for await (const chunk of fullStream) {
                          switch (chunk.type) {
                            case 'tool-call':
                              writer.write({
                                type: 'tool-input-available',
                                toolCallId: chunk.toolCallId,
                                toolName: chunk.toolName,
                                input: chunk.input,
                                dynamic: chunk.dynamic,
                              })
                              break
                            case 'tool-result':
                              writer.write({
                                type: 'tool-output-available',
                                toolCallId: chunk.toolCallId,
                                output: chunk.output,
                                dynamic: chunk.dynamic,
                              })
                              break
                            case 'tool-error':
                              writer.write({
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
                          logger.warn(
                            'Sampling completed without generated text; responding with an empty assistant message.',
                          )
                        } else {
                          throw error
                        }
                      }

                      mediator.emit('mcpToolSamplingResult', {
                        id: request.id,
                        data: {
                          toolCallId,
                          model: model.modelId,
                          role: 'assistant',
                          content: {
                            type: 'text',
                            text: assistantText,
                          },
                        },
                      })
                    })().catch((error) => {
                      logger.error({ error }, 'Failed to process sampling request.')
                    })
                  })
                }),
            )
        })
    },
  }
}
