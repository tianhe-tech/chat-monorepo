import type { LanguageModelV2 } from '@ai-sdk/provider'
import { dynamicTool, jsonSchema, type DynamicToolUIPart, type ToolUIPart, type UIMessageStreamWriter } from 'ai'
import type { convertMCPToolToAITool } from './tool'
import type { MyUIMessage } from './types'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  type CallToolResult,
  type CallToolRequest,
  type Tool as MCPTool,
  type CreateMessageRequest as SamplingRequest,
  type CreateMessageResult as SamplingResult,
  type ElicitRequest,
  type Progress,
  ElicitRequestSchema,
  CreateMessageRequestSchema as SamplingRequestSchema,
  ProgressSchema,
  CallToolResultSchema,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
import ky from 'ky'
import { env } from '../env'
import { err, ok, Result, ResultAsync } from 'neverthrow'
import { consola, type ConsolaInstance } from 'consola'
import assert from 'node:assert'
import type { ToolConfirmInput } from '@repo/shared/ai'
import EventEmitter from 'node:events'
import { z as z3 } from 'zod3'
import { MCPMessageChannel, type MCPMessageChannelString } from '@repo/shared/types'
import { PubSub } from '@repo/shared/utils'
import { colorize } from 'consola/utils'

export type ChatMCPContext = {
  currentToolCallId?: string
  writer?: UIMessageStreamWriter<MyUIMessage>
  model: LanguageModelV2
  abort: () => void
  mcpTools: ReturnType<typeof convertMCPToolToAITool>[]
}

export const chatMCPContext = new AsyncLocalStorage<ChatMCPContext>()

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

type AITool = ReturnType<typeof dynamicTool> & { isEntry?: boolean }
type ToolName = string

/** Service to communicate with MCP Client/Host within a single request.
 *
 *  This class should only be instantiated and associated with a single request.
 */
export class ChatMCPService
  extends EventEmitter<{
    samplingRequest: [SamplingRequest['params'] & { serverName: string }]
    elicitationRequest: [ElicitRequest['params'] & { serverName: string }]
    progress: [Progress & { progressToken?: string }]
    toolCallResult: [CallToolResult & { progressToken?: string }]
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
  #tools?: ResultAsync<[string, ReturnType<typeof dynamicTool> & { isEntry?: boolean }][], unknown>
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
          MCPMessageChannel.SamplingRequest,
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

    if (part.state !== 'input-available') {
      return part
    }

    const { _confirm } = part.input as ToolConfirmInput
    if (!_confirm) {
      this.#logger.warn('Invalid tool state: input-available but no _confirm field')
      return part
    }

    return await this.#sendElicitationResult({ action: _confirm }).match(
      () =>
        new Promise<DynamicToolUIPart>((resolve, reject) => {
          setTimeout(() => reject(new Error('Tool call timed out')), 10_000)

          this.on('toolCallResult', ({ content, isError, progressToken }) => {
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
              })
            }

            resolve({
              ...part,
              state: 'output-available',
              output: result.value,
            })
          })
        }),
      () => ({
        ...part,
        state: 'output-error',
        errorText: 'Internal tool state error',
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
    return [
      mcpTool.name,
      {
        isEntry: mcpTool._meta?.isEntry as boolean,
        ...dynamicTool({
          inputSchema: jsonSchema(mcpTool.inputSchema as any),
          description: mcpTool.description,
          execute: async (input, { toolCallId }) => {
            this.#currentToolCallId = toolCallId

            const result = await this.callTool({
              name: mcpTool.name,
              arguments: input as Record<string, unknown>,
              _meta: {
                progressToken: toolCallId,
              },
            })

            this.#currentToolCallId = undefined

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
      .object({ id: z3.string(), data: CallToolResultSchema.extend({ progressToken: z3.optional(z3.string()) }) })
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
    } = z3
      .object({ id: z3.string(), data: ProgressSchema.extend({ progressToken: z3.string() }) })
      .safeParse(JSON.parse(message))
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
    const {
      success,
      data: parsed,
      error,
    } = z3
      .object({ id: z3.string(), data: SamplingRequestSchema.shape.params.extend({ serverName: z3.string() }) })
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
    this.#logger.debug('Sending sampling result to MCP:', result)
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
    this.on('elicitationRequest', async ({ message, requestedSchema }) => {
      if (!this.#currentToolCallId) {
        this.#logger.warn('Received elicitation request outside of tool call, cancelling')
        await this.#sendElicitationResult({ action: 'cancel' })
        return
      }

      this.#logger.debug('elicitationRequest event received, aborting stream')
      this.#streamWriter.write({
        type: 'data-aborted-tool',
        transient: false,
        data: {
          abortReason: 'elicit',
          toolCallId: this.#currentToolCallId,
          toolType: 'mcp',
        },
      })

      this.#abort()
    })
  }

  #handleProgress = () => {
    this.on('progress', ({ progress, message, progressToken, total }) => {
      this.#streamWriter.write({
        type: 'data-progress',
        id: `progress-${progressToken}`,
        data: {
          progress,
          message,
          total,
        },
      })
    })
  }
}
