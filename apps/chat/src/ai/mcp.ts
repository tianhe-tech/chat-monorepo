import {
  CallToolResultSchema,
  ElicitRequestSchema,
  ProgressSchema,
  CreateMessageRequestSchema as SamplingRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type ElicitRequest,
  type ElicitResult,
  type Tool as MCPTool,
  type Progress,
  type CreateMessageRequest as SamplingRequest,
  type CreateMessageResult as SamplingResult,
} from '@modelcontextprotocol/sdk/types.js'
import {
  isElicitationResponse,
  MCPMessageChannel,
  toolIntentSchema,
  UIPartTag,
  type MCPMessageChannelString,
  type MCPToolDefinitionMeta,
  type SamplingRequestMeta,
} from '@internal/shared/types'
import { PubSub } from '@internal/shared/utils'
import { dynamicTool, jsonSchema, type DynamicToolUIPart, type UIMessageStreamWriter } from 'ai'
import { consola, type ConsolaInstance } from 'consola'
import { colorize } from 'consola/utils'
import ky from 'ky'
import { err, ok, Result, ResultAsync } from 'neverthrow'
import assert from 'node:assert'
import EventEmitter from 'node:events'
import { z } from 'zod'
import { z as z3 } from 'zodv3'
import { env } from '../env'
import type { MyUIMessage } from './types'

type ChatMCPServiceConstructorOptions = {
  threadId: string
  signal: AbortSignal
  pubsub: PubSub<MCPMessageChannelString>
  writer: UIMessageStreamWriter<MyUIMessage>
  abort: () => void
}

type ChatMCPServiceFactoryOptions = Omit<ChatMCPServiceConstructorOptions, 'pubsub'> & {
  valkeyAddresses: { host: string; port: number }[]
}

type AITool = ReturnType<typeof dynamicTool> &
  MCPToolDefinitionMeta & {
    annotations?: { title?: string }
  }
type ToolName = string

/** Service to communicate with MCP Client/Host within a single request.
 *
 *  This class should only be instantiated and associated with a single request.
 */
export class ChatMCPService
  extends EventEmitter<{
    samplingRequest: [SamplingRequest['params'] & { serverName: string; metadata?: SamplingRequestMeta }]
    elicitationRequest: [ElicitRequest['params'] & { serverName: string }]
    progress: [Progress & { progressToken?: string }]
    toolCallResult: [CallToolResult & { _meta?: { progressToken?: string } }]
    error: unknown[]
  }>
  implements AsyncDisposable
{
  #logger: ConsolaInstance
  #threadId: string
  #signal: AbortSignal
  #fetch = ky.create({
    prefixUrl: env.MCP_SERVICE_URL,
  })
  #tools?: ResultAsync<[string, AITool][], unknown>
  #pubsub: PubSub<MCPMessageChannelString>
  #publish: (channel: MCPMessageChannelString, data: object) => Promise<number>
  #currentToolCallId?: string
  #streamWriter: UIMessageStreamWriter<MyUIMessage>
  #abort: () => void

  private constructor({ threadId, signal, pubsub, writer, abort }: ChatMCPServiceConstructorOptions) {
    super()

    this.#threadId = threadId
    this.#signal = signal
    this.#pubsub = pubsub
    this.#streamWriter = writer
    this.#abort = abort
    this.#logger = consola.withTag(`ChatMCPService:${threadId}`)

    this.#publish = (channel, data) => pubsub.publish({ channel, message: JSON.stringify({ data, id: threadId }) })

    this.on('error', (err) => this.#logger.error('Error event in ChatMCPService:', err))
    this.#handleElicitationRequest()
    this.#handleProgress()
  }

  static new({ signal, threadId, valkeyAddresses, abort, writer }: ChatMCPServiceFactoryOptions) {
    let local = {
      handleSamplingRequest: (_m: string) => {},
      handleElicitationRequest: (_m: string) => {},
      handleProgress: (_m: string) => {},
      handleToolCallResult: (_m: string) => {},
      logger: consola.withTag(colorize('redBright', `!!Uninitialized:${threadId}!!`)),
    }

    const createPubSub = ResultAsync.fromPromise(
      PubSub.new<MCPMessageChannelString>({
        channels: [
          MCPMessageChannel.SamplingRequest,
          MCPMessageChannel.ElicitationRequest,
          MCPMessageChannel.Progress,
          MCPMessageChannel.ToolCallResult,
        ],
        valkeyAddresses,
        logTag: `ChatMCPPubSub:${threadId}`,
        subCallback: ({ channel, message }) => {
          switch (channel) {
            case MCPMessageChannel.SamplingRequest:
              local.handleSamplingRequest(message)
              break
            case MCPMessageChannel.ElicitationRequest:
              local.handleElicitationRequest(message)
              break
            case MCPMessageChannel.Progress:
              local.handleProgress(message)
              break
            case MCPMessageChannel.ToolCallResult:
              local.handleToolCallResult(message)
              break
            default:
              local.logger.warn(`Received message on unknown channel ${channel}:`, message)
          }
        },
      }),
      (e) => e,
    )

    return createPubSub.map((pubsub) => {
      const instance = new ChatMCPService({ threadId, signal, pubsub, abort, writer })
      local = {
        handleSamplingRequest: instance.#emitSamplingRequest,
        handleElicitationRequest: instance.#emitElicitationRequest,
        handleProgress: instance.#emitProgress,
        handleToolCallResult: instance.#emitToolCallResult,
        logger: instance.#logger,
      }
      return instance
    })
  }

  callTool(params: CallToolRequest['params']) {
    this.#logger.debug(`Calling MCP Tool ${params.name} with params:`, params)
    return ResultAsync.fromPromise(
      this.#fetch
        .post('tools', {
          json: params,
          headers: {
            'mcp-thread-id': this.#threadId,
          },
          signal: this.#signal,
          timeout: 120_000,
        })
        .json<CallToolResult>(),
      (e) => e,
    ).andThen(({ content, isError }) => {
      this.#logger.debug(`MCP Tool ${params.name} call finished.`)

      if (isError) {
        const msg = `MCP Tool ${params.name} execution failed:`
        this.#logger.error(msg, { content })
        return err(new Error(msg))
      }

      return Result.combine(
        content.map((c) => {
          if (c.type !== 'text') {
            this.#logger.error('Unexpected content type:', c)
            return err(new Error(`Unexpected content type: ${c.type}`))
          }
          return ok(c.text)
        }),
      )
    })
  }

  close() {
    this.#logger.debug('Disposing ChatMCPService...')
    this.removeAllListeners()
    this.#pubsub.close()
  }

  async [Symbol.asyncDispose]() {
    this.close()
  }

  getTools(): ResultAsync<[ToolName, AITool][], unknown> {
    const doFetch = () =>
      this.#fetchMCPTools()
        .map((byServer) => byServer ?? {})
        .map((byServer) =>
          Object.entries(byServer).flatMap(([serverName, mcpTools]) =>
            mcpTools.map((mcpTool) =>
              this.#convertMCPToolToAITool({ ...mcpTool, name: `${serverName}_${mcpTool.name}` }),
            ),
          ),
        )

    if (this.#tools === undefined) {
      this.#tools = doFetch()
    } else {
      this.#tools = this.#tools.orElse(doFetch)
    }

    return this.#tools
  }

  async fulfillToolElicitation(part: DynamicToolUIPart): Promise<DynamicToolUIPart> {
    assert.ok(part.type === 'dynamic-tool')

    const output = part.output
    this.#logger.debug('Fulfilling tool elicitation for part:', part)

    if (!isElicitationResponse(output)) {
      return part
    }

    const elicitationResponse = output
    this.#logger.debug('ElicitationResponse', elicitationResponse)

    return this.#sendElicitationResult(elicitationResponse).match(
      () =>
        new Promise<DynamicToolUIPart>((resolve, reject) => {
          const toolResultHandler = ({
            content,
            isError,
            _meta,
          }: CallToolResult & { _meta?: { progressToken?: string } }) => {
            clearTimeout(timeout)

            const progressToken = _meta?.progressToken

            if (progressToken !== part.toolCallId) {
              this.#logger.warn(`Mismatched tool call id: expected ${part.toolCallId} but got ${progressToken}`)
              const errorText = 'Internal Tool state error'
              this.#streamWriter.write({
                type: 'tool-output-error',
                toolCallId: part.toolCallId,
                dynamic: true,
                errorText,
              })
              return resolve({
                ...part,
                state: 'output-error',
                errorText,
                output: undefined,
              })
            }

            const result = Result.combine(
              content.map((c) => {
                if (c.type !== 'text') {
                  this.#logger.error('Unexpected content type:', c)
                  return err(new Error(`Unexpected content type: ${c.type}`))
                }
                return ok(c.text)
              }),
            ).map((texts) => texts.join('\n'))

            if (result.isErr()) {
              this.#logger.error('Tool call failed:', result.error)
              return reject(result.error)
            }

            if (isError) {
              this.#streamWriter.write({
                type: 'tool-output-error',
                toolCallId: part.toolCallId,
                dynamic: true,
                errorText: result.value,
              })
              return resolve({
                ...part,
                state: 'output-error',
                errorText: result.value,
                output: undefined,
              })
            }

            const { toolCallId, input, toolName, type } = part

            this.#streamWriter.write({
              type: 'tool-output-available',
              toolCallId: part.toolCallId,
              dynamic: true,
              output: result.value,
            })
            resolve({
              type,
              state: 'output-available',
              output: result.value,
              toolCallId,
              input,
              toolName,
            })
          }

          const timeout = setTimeout(() => {
            reject(new Error('Tool call timed out'))
            this.off('toolCallResult', toolResultHandler)
          }, 20_000)

          this.once('toolCallResult', toolResultHandler)
        }),
      () => ({
        ...part,
        state: 'output-error',
        errorText: 'Internal tool state error',
        output: undefined,
      }),
    )
  }

  #fetchMCPTools() {
    this.#logger.debug('Fetching MCP tools...')
    return ResultAsync.fromPromise(
      this.#fetch
        .get('tools', {
          headers: { 'mcp-thread-id': this.#threadId },
          signal: this.#signal,
        })
        .json<Record<string, MCPTool[]>>(),
      (err) => {
        this.#logger.error('Failed to fetch MCP tools:', err)
        return err
      },
    ).andTee((tools) => {
      this.#logger.debug('Fetched MCP tools:', tools)
    })
  }

  #convertMCPToolToAITool(mcpTool: MCPTool): [ToolName, AITool] {
    const mergedInputSchema: Record<string, unknown> = {
      type: 'object',
      properties: {
        ...z.toJSONSchema(toolIntentSchema).properties,
        params: mcpTool.inputSchema,
      },
    }

    return [
      mcpTool.name,
      {
        category: (mcpTool._meta?.category as any) ?? 'tool',
        annotations: mcpTool.annotations,
        ...dynamicTool({
          inputSchema: jsonSchema(mergedInputSchema),
          description: mcpTool.description,
          execute: async (input, { toolCallId }) => {
            const prevToolCallId = this.#currentToolCallId
            this.#currentToolCallId = toolCallId
            new DisposableStack().defer(() => (this.#currentToolCallId = prevToolCallId))

            const params = (input as any)?.params
            const result = await this.callTool({
              name: mcpTool.name,
              arguments: params,
              _meta: {
                progressToken: toolCallId,
              },
            })

            if (result.isErr()) {
              throw result.error
            }

            return result.value
          },
        }),
      },
    ]
  }

  #emitToolCallResult = (message: string) => {
    const {
      success,
      data: parsed,
      error,
    } = z3
      .object({
        id: z3.string(),
        data: CallToolResultSchema,
      })
      .safeParse(JSON.parse(message))
    if (!success) {
      const m = 'Invalid tool call result received'
      this.#logger.error(m, error.message)
      throw new Error(m)
    }
    if (parsed.id === this.#threadId) {
      this.emit('toolCallResult', parsed.data)
    }
  }

  #emitProgress = (message: string) => {
    const {
      success,
      data: parsed,
      error,
    } = z3.object({ id: z3.string(), data: ProgressSchema }).safeParse(JSON.parse(message))
    if (!success) {
      const m = 'Invalid progress request received'
      this.#logger.error(m, error.message)
      throw new Error(m)
    }
    if (parsed.id === this.#threadId) {
      this.emit('progress', parsed.data)
    }
  }

  #emitSamplingRequest = (message: string) => {
    this.#logger.debug('Received sampling request message:', message)
    const {
      success,
      data: parsed,
      error,
    } = z3
      .object({
        id: z3.string(),
        data: SamplingRequestSchema.shape.params.extend({
          serverName: z3.string(),
          metadata: z3.optional(z3.object({ tools: z3.optional(z3.array(z3.string())) })),
        }),
      })
      .safeParse(JSON.parse(message))
    if (!success) {
      const m = 'Invalid sampling request received'
      this.#logger.error(m, error.message)
      throw new Error(m)
    }
    if (parsed.id === this.#threadId) {
      this.emit('samplingRequest', parsed.data)
    }
  }

  #emitElicitationRequest = (message: string) => {
    this.#logger.debug('Received elicitation request message:', message)
    const {
      success,
      data: parsed,
      error,
    } = z3
      .object({ id: z3.string(), data: ElicitRequestSchema.shape.params.extend({ serverName: z3.string() }) })
      .safeParse(JSON.parse(message))
    if (!success) {
      const m = 'Invalid elicitation request received'
      this.#logger.error(m, error.message)
      throw new Error(m)
    }
    if (parsed.id === this.#threadId) {
      this.emit('elicitationRequest', parsed.data)
    }
  }

  #sendElicitationResult = (result: ElicitResult) => {
    this.#logger.debug('Sending elicitation result to MCP:', result)
    const publish = ResultAsync.fromPromise(this.#publish(MCPMessageChannel.ElicitationResult, result), (err) => {
      this.#logger.error('Failed to send elicitation result to MCP:', err)
      return err
    })

    return publish.andThen((subCount) => {
      if (subCount === 0) {
        const e = new Error('Elicitation result was not delivered, no subscribers')
        this.#logger.error(e.message)
        return err(e)
      }
      return ok(subCount)
    })
  }

  sendSamplingResult = (result: SamplingResult) => {
    const publish = ResultAsync.fromPromise(this.#publish(MCPMessageChannel.SamplingResult, result), (err) => {
      this.#logger.error('Failed to send sampling result to MCP:', err)
      return err
    })

    return publish.andThen((subCount) => {
      if (subCount === 0) {
        const e = new Error('Sampling result was not delivered, no subscribers')
        this.#logger.error(e.message)
        return err(e)
      }
      return ok(subCount)
    })
  }

  #handleElicitationRequest = () => {
    this.on('elicitationRequest', async (request) => {
      if (!this.#currentToolCallId) {
        this.#logger.warn('Received elicitation request outside of tool call, cancelling')
        await this.#sendElicitationResult({ action: 'cancel' })
        return
      }

      this.#logger.debug('elicitationRequest event received, aborting stream')
      this.#streamWriter.write({
        type: 'tool-output-available',
        toolCallId: this.#currentToolCallId!,
        output: {
          [UIPartTag.IsElicitationRequest]: true,
          ...request,
        },
        dynamic: true,
      })

      this.#abort()
    })
  }

  #handleProgress = () => {
    this.on('progress', ({ progress, message, total }) => {
      this.#streamWriter.write({
        type: 'data-progress',
        id: this.#currentToolCallId,
        data: {
          progress,
          message,
          total,
        },
      })
    })
  }
}
