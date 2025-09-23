import {
  type CallToolResult,
  CallToolResultSchema,
  type ElicitRequest,
  ElicitRequestSchema,
  type ElicitResult,
  type Progress,
  ProgressSchema,
  type CreateMessageRequest as SamplingRequest,
  CreateMessageRequestSchema as SamplingRequestSchema,
  type CreateMessageResult as SamplingResult,
} from '@modelcontextprotocol/sdk/types.js'
import { MCPMessageChannels } from '@repo/mcp/mcp'
import { GlideClient, GlideClientConfiguration } from '@valkey/valkey-glide'
import { consola } from 'consola'
import { createMiddleware } from 'hono/factory'
import EventEmitter from 'node:events'
import { z as z3 } from 'zod3'
import { env } from '../env'
import { AsyncLocalStorage } from 'node:async_hooks'
import { useChatALS } from '../context/chat-als'
import { generateText } from 'ai'
import assert from 'node:assert/strict'

const pubConn = await GlideClient.createClient({
  addresses: env.VALKEY_ADDRESSES,
  lazyConnect: true,
})

type MCPEventMap = {
  samplingRequest: [SamplingRequest['params'] & { serverName: string }]
  elicitationRequest: [ElicitRequest['params'] & { serverName: string }]
  progress: [Progress & { progressToken?: string }]
  toolCallResult: [CallToolResult & { progressToken?: string }]
  error: unknown[]
}

/**
 * @pre Auth Middleware
 * @pre Stream Finish Middleware
 * @pre `body.threadId` validated
 */
const mcpMiddleware = createMiddleware(async (c, next) => {
  const { threadId } = await c.req.json()

  // type guard. validation logic should be handled in route
  assert.ok(typeof threadId === 'string')

  const logger = consola.withTag(`MCP Middleware ${threadId}`)

  const emitter = new EventEmitter<MCPEventMap>()
  emitter.on('error', (err) => logger.error('Error event in MCP Middleware:', err))

  function handleSamplingRequest(message: string) {
    const { success, data, error } = SamplingRequestSchema.shape.params
      .extend({ threadId: z3.string(), serverName: z3.string() })
      .safeParse(JSON.parse(message))
    if (!success) {
      const m = 'Invalid sampling request received'
      logger.error(m, error.message)
      throw new Error(m)
    }
    if (data.threadId === threadId) {
      emitter.emit('samplingRequest', data)
    }
  }

  function handleElicitationRequest(message: string) {
    const { success, data, error } = ElicitRequestSchema.shape.params
      .extend({ threadId: z3.string(), serverName: z3.string() })
      .safeParse(JSON.parse(message))
    if (!success) {
      const m = 'Invalid elicitation request received'
      logger.error(m, error.message)
      throw new Error(m)
    }
    if (data.threadId === threadId) {
      emitter.emit('elicitationRequest', data)
    }
  }

  function handleProgress(message: string) {
    const { success, data, error } = ProgressSchema.extend({
      threadId: z3.string(),
      progressToken: z3.string(),
    }).safeParse(JSON.parse(message))
    if (!success) {
      const m = 'Invalid progress request received'
      logger.error(m, error.message)
      throw new Error(m)
    }
    if (data.threadId === threadId) {
      emitter.emit('progress', data)
    }
  }

  function handleToolCallResult(message: string) {
    const { success, data, error } = CallToolResultSchema.extend({
      threadId: z3.string(),
      progressToken: z3.string(),
    }).safeParse(JSON.parse(message))
    if (!success) {
      const m = 'Invalid tool call result received'
      logger.error(m, error.message)
      throw new Error(m)
    }
    if (data.threadId === threadId) {
      emitter.emit('toolCallResult', data)
    }
  }

  async function sendSamplingResult(result: SamplingResult) {
    logger.debug(`Publishing sampling result:`, result)
    const subCount = await pubConn.publish(JSON.stringify({ ...result, threadId }), MCPMessageChannels.SamplingResult)
    if (subCount === 0) {
      logger.warn('Sampling result is not handled by any subscriber')
    }
    return subCount
  }

  async function sendElicitationResult(result: ElicitResult) {
    logger.debug(`Publishing elicitation result:`, result)
    const subCount = await pubConn.publish(
      JSON.stringify({ ...result, threadId }),
      MCPMessageChannels.ElicitationResult,
    )
    if (subCount === 0) {
      logger.warn('Elicitation result is not handled by any subscriber')
    }
    return subCount
  }

  function setupMCPEventHandlers() {
    onMCPEvent(
      'elicitationRequest',
      AsyncLocalStorage.bind(async ({ message, requestedSchema }) => {
        const { currentToolCallId, writer, abort } = useChatALS()
        if (!currentToolCallId) {
          logger.warn('Received elicitation request outside of tool call, cancelling')
          return sendElicitationResult({ action: 'cancel' })
        }

        logger.debug('elicitationRequest event received, aborting stream')
        writer?.write({
          type: 'data-aborted-tool',
          transient: false,
          data: {
            abortReason: 'elicit',
            toolCallId: currentToolCallId,
            toolType: 'mcp',
          },
        })
        abort()
      }),
    )

    onMCPEvent(
      'samplingRequest',
      AsyncLocalStorage.bind(async ({ messages, systemPrompt, includeContext, serverName, metadata }) => {
        logger.debug('Received sampling request', { serverName, includeContext, metadata, systemPrompt, messages })
        const { mcpTools, signal, model } = useChatALS()

        const includeTools = (() => {
          if (includeContext === 'none') {
            return []
          }
          if (includeContext === 'allServers') {
            return mcpTools
          }

          const toolNames = metadata?.tools as string[] | undefined
          if (toolNames) {
            return mcpTools.filter(([name]) => toolNames.some((toolName) => name === `${serverName}_${toolName}`))
          }
          return mcpTools.filter(([name, tool]) => name.startsWith(`${serverName}_`) && !tool.isEntry)
        })()

        const { text } = await generateText({
          model,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content.text as string,
          })),
          system: systemPrompt,
          tools: Object.fromEntries(includeTools),
          abortSignal: signal,
        })

        await sendSamplingResult({
          model: model.modelId,
          role: 'assistant',
          content: {
            type: 'text',
            text,
          },
        })
      }),
    )

    onMCPEvent(
      'progress',
      AsyncLocalStorage.bind(async ({ progress, message, progressToken, total }) => {
        const { writer } = useChatALS()
        writer?.write({
          type: 'data-progress',
          id: `progress-${progressToken}`,
          data: {
            progress,
            message,
            total,
          },
        })
      }),
    )
  }

  const onMCPEvent = emitter.on.bind(emitter)

  c.set('mcpContext', { setupMCPEventHandlers, sendElicitationResult, onMCPEvent })

  const sub = await GlideClient.createClient({
    addresses: env.VALKEY_ADDRESSES,
    pubsubSubscriptions: {
      channelsAndPatterns: {
        [GlideClientConfiguration.PubSubChannelModes.Exact]: new Set([
          MCPMessageChannels.SamplingRequest,
          MCPMessageChannels.ElicitationRequest,
          MCPMessageChannels.Progress,
          MCPMessageChannels.ToolCallResult,
        ]),
      },
      callback: (msg) => {
        const channel = msg.channel.toString()
        const message = msg.message.toString()

        switch (channel) {
          case MCPMessageChannels.SamplingRequest:
            handleSamplingRequest(message)
            break
          case MCPMessageChannels.ElicitationRequest:
            handleElicitationRequest(message)
            break
          case MCPMessageChannels.Progress:
            handleProgress(message)
            break
          case MCPMessageChannels.ToolCallResult:
            handleToolCallResult(message)
            break
          default:
            logger.warn(`Unknown channel: ${channel}`)
        }
      },
    },
  })

  await next()

  c.get('onStreamFinish')(() => {
    logger.debug('Cleaning up resources...')
    emitter.removeAllListeners()
    sub.close()
  })
})

export default mcpMiddleware

declare module 'hono' {
  interface ContextVariableMap {
    mcpContext: {
      sendElicitationResult: (result: ElicitResult) => Promise<number>
      onMCPEvent: EventEmitter<MCPEventMap>['on']
      setupMCPEventHandlers: () => void
    }
  }
}
