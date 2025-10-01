import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DEFAULT_REQUEST_TIMEOUT_MSEC, type ProgressCallback } from '@modelcontextprotocol/sdk/shared/protocol.js'
import {
  CreateMessageRequestSchema as SamplingRequestSchema,
  ElicitRequestSchema,
  LoggingMessageNotificationSchema,
  type CallToolRequest,
  type CallToolResult,
  type CreateMessageRequest as SamplingRequest,
  type CreateMessageResult as SamplingResult,
  type ElicitRequest,
  type ElicitResult,
  type LoggingMessageNotification,
  type Tool as MCPTool,
  type Prompt,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js'
import { MCPMessageChannel, type MCPMessageChannelString } from '@repo/shared/types'
import { PubSub, type ValkeyAddresses } from '@repo/shared/utils'
import { consola, type ConsolaInstance } from 'consola'
import { ResultAsync, err, errAsync, ok, okAsync } from 'neverthrow'
import { z } from 'zod'
import { z as z3 } from 'zodv3'
import { env } from '../env'
import type { MCPServerDefinition } from '@repo/shared/types'

type PubSubOptions = {
  valkeyAddresses: ValkeyAddresses
  id: string
}

type MCPClientManagerOptions = {
  servers: Record<string, MCPServerDefinition>
  pubsubOptions?: PubSubOptions
}

// TODO: connection and message broker lifetime management
export class MCPClientManager {
  readonly #serverConfigs: Record<string, MCPServerDefinition>
  readonly #mcpClientsByName = new Map<string, InternalMCPClient>()
  #logger: ConsolaInstance
  /**
   * Mapping of server names to their respective tools
   */
  #tools?: ResultAsync<Record<string, MCPTool[]>, unknown>
  #pubsub?: PubSub<MCPMessageChannelString>
  #clientDisposableStack = new AsyncDisposableStack()

  private constructor({ servers }: Pick<MCPClientManagerOptions, 'servers'>) {
    this.#serverConfigs = servers
    this.#logger = consola.withTag('MCPClientManager')
  }

  static createMCPClientManager({ servers, pubsubOptions }: MCPClientManagerOptions) {
    const instance = new MCPClientManager({ servers })
    if (!pubsubOptions) {
      return okAsync(instance)
    }
    return instance.#setupPubSub(pubsubOptions).map(() => instance)
  }

  #publish?: (channel: MCPMessageChannelString, data: object) => Promise<number>

  #setupPubSub({ valkeyAddresses, id }: PubSubOptions) {
    const createPubSub = ResultAsync.fromThrowable(() =>
      PubSub.createPubSub<MCPMessageChannelString>({
        channels: Object.values(MCPMessageChannel),
        valkeyAddresses,
        logTag: `MCPClientPubSub:${id}`,
        subCallback: ({ channel, message }) => {},
      }),
    )

    const created = createPubSub()

    created.map((pubsub) => {
      this.#pubsub = pubsub
      this.#publish = (channel: MCPMessageChannelString, data: object) =>
        pubsub.publish({ channel, message: JSON.stringify({ ...data, id }) })
    })
  }

  async [Symbol.asyncDispose]() {
    await this.#clientDisposableStack.disposeAsync()
    this.#pubsub?.close()
  }

  #getConnectedClientForServer(serverName: string) {
    const serverConfig = this.#serverConfigs[serverName]
    if (!serverConfig) {
      throw new Error(`No server configuration found for server name: ${serverName}`)
    }

    const handleConnectionError = (err: unknown) => {
      this.#logger.error(`Error connecting to server ${serverName}:`, err)
      this.#mcpClientsByName.delete(serverName)
      return err
    }

    const getConnectedClient = (client: InternalMCPClient) =>
      client
        .connect()
        .mapErr(handleConnectionError)
        .map(() => client)

    const existingClient = this.#mcpClientsByName.get(serverName)
    if (existingClient) {
      this.#logger.debug(`Reusing existing connected client for server: ${serverName}`)
      return getConnectedClient(existingClient)
    }

    this.#logger.debug(`Creating new client for server: ${serverName}`)
    const client = new InternalMCPClient({
      name: serverName,
      server: serverConfig,
      timeout: env.MCP_CACHE_TTL_MS / 2,
      onProgress: (progress) => {
        this.#publish?.(MCPMessageChannel.Progress, progress)
      },
    })
    this.#mcpClientsByName.set(serverName, client)
    this.#clientDisposableStack.use(client)

    return getConnectedClient(client)
  }

  fetchTools() {
    this.#tools = ResultAsync.combine(
      Object.keys(this.#serverConfigs).map((serverName) =>
        this.#getConnectedClientForServer(serverName)
          .andThen((client) => client.listTools())
          .map((tools) => [serverName, tools]),
      ),
    ).map(Object.fromEntries)
    return this.#tools
  }

  listTools() {
    if (this.#tools) {
      return this.#tools.orElse(() => this.fetchTools())
    }
    return this.fetchTools()
  }

  readonly constructToolName = ({ serverName, toolName }: { serverName: string; toolName: string }) =>
    `${serverName}_${toolName}`

  readonly destructToolName = (fullToolName: string): { serverName: string; toolName: string } => {
    const underscoreIndex = fullToolName.indexOf('_')
    if (underscoreIndex === -1) {
      throw new Error(`Invalid tool name format: ${fullToolName}`)
    }
    const serverName = fullToolName.substring(0, underscoreIndex)
    const toolName = fullToolName.substring(underscoreIndex + 1)
    return { serverName, toolName }
  }

  callTool(params: CallToolRequest['params'], options?: { signal?: AbortSignal }) {
    const { serverName, toolName } = this.destructToolName(params.name)
    return this.#getConnectedClientForServer(serverName).andThen((client) =>
      client
        .callTool({ ...params, name: toolName }, options)
        .andTee((result) => this.#publish?.(MCPMessageChannel.ToolCallResult, result as CallToolResult)),
    )
  }

  setSamplingHandlerForServer(
    serverName: string,
    handler: (params: SamplingRequest['params']) => ResultAsync<SamplingResult, unknown>,
  ) {
    return this.#getConnectedClientForServer(serverName).andThen((client) => client.setSamplingHandler(handler))
  }

  setElicitationHandlerForServer(
    serverName: string,
    handler: (params: ElicitRequest['params']) => ResultAsync<ElicitResult, unknown>,
  ) {
    return this.#getConnectedClientForServer(serverName).andThen((client) => client.setElicitationHandler(handler))
  }

  setSamplingHandler(
    handler: (params: SamplingRequest['params'] & { serverName: string }) => ResultAsync<SamplingResult, unknown>,
  ) {
    this.#logger.verbose(`Setting sampling handler for all servers:`, handler.toString())
    const serverNames = Object.keys(this.#serverConfigs)
    return ResultAsync.combine(
      serverNames.map((serverName) =>
        this.setSamplingHandlerForServer(serverName, (params) => handler({ ...params, serverName })),
      ),
    )
  }

  setElicitationHandler(
    handler: (params: ElicitRequest['params'] & { serverName: string }) => ResultAsync<ElicitResult, unknown>,
  ) {
    this.#logger.verbose(`Setting elicitation handler for all servers:`, handler.toString())
    const serverNames = Object.keys(this.#serverConfigs)
    return ResultAsync.combine(
      serverNames.map((serverName) =>
        this.setElicitationHandlerForServer(serverName, (params) => handler({ ...params, serverName })),
      ),
    )
  }

  setLogHandlerForServer(
    serverName: string,
    handler: (params: LoggingMessageNotification['params']) => ResultAsync<void, unknown>,
  ) {
    return this.#getConnectedClientForServer(serverName).andThen((client) => client.setLogHandler(handler))
  }

  setLogHandler(
    handler: (params: LoggingMessageNotification['params'] & { serverName: string }) => ResultAsync<void, unknown>,
  ) {
    this.#logger.verbose('Setting log handler for all servers:', handler.toString())
    const serverNames = Object.keys(this.#serverConfigs)
    return ResultAsync.combine(
      serverNames.map((serverName) =>
        this.setLogHandlerForServer(serverName, (params) => handler({ ...params, serverName })),
      ),
    )
  }

  // oxlint-disable-next-line no-unused-private-class-members
  #getSamplingHandler() {
    const publish = this.#publish
    if (!this.#pubsub || !publish) {
      this.#logger.warn('PubSub not initialized, skipping sampling setup')
      return err(new Error('PubSub not initialized'))
    }
    return ok((params: SamplingRequest['params']) => {
      const subCount = publish(MCPMessageChannel.SamplingRequest, params)
    })
  }
}

type InternalMCPClientOptions = {
  name: string
  version?: string
  server: MCPServerDefinition
  timeout?: number
  onProgress?: ProgressCallback
}

// TODO: resume connection
export class InternalMCPClient {
  readonly name: string
  readonly #timeout: number
  readonly #isTrusted: boolean
  #client: Client
  #serverConfig: MCPServerDefinition
  #transport?: StreamableHTTPClientTransport
  #isConnected?: ResultAsync<boolean, unknown>
  #logger: ConsolaInstance
  resources?: Promise<Resource[]>
  prompts?: Promise<Prompt[]>
  tools?: ResultAsync<MCPTool[], unknown>
  #onProgress?: ProgressCallback

  constructor({
    name,
    version = '0.0.1',
    server,
    timeout = DEFAULT_REQUEST_TIMEOUT_MSEC,
    onProgress,
  }: InternalMCPClientOptions) {
    this.name = name
    this.#client = new Client(
      { name, version },
      {
        capabilities: {
          elicitation: {},
          sampling: {},
        },
      },
    )
    this.#serverConfig = server
    this.#timeout = timeout
    this.#onProgress = onProgress
    this.#logger = consola.withTag(`InternalMCPClient:${name}`)
    this.#isTrusted = env.TRUSTED_MCP_ORIGINS.includes(new URL(server.url).origin)
    this.#logger.debug('Instantiated')
  }

  connect() {
    if (this.#isConnected !== undefined) {
      return this.#isConnected
    }

    const { url, headers } = this.#serverConfig

    const doConnect = ResultAsync.fromThrowable(async () => {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers },
      })
      this.#transport = transport

      this.#logger.debug(`Attempting Streamable HTTP connection on URL: ${url}`)
      return this.#client.connect(transport, { timeout: 5_000 })
    })

    this.#isConnected = doConnect()
      .andTee(() => {
        const originalOnClose = this.#client.onclose
        // oxlint-disable-next-line prefer-add-event-listener
        this.#client.onclose = () => {
          this.#logger.debug('Connection closed')
          this.#isConnected = okAsync(false)
          originalOnClose?.()
        }
      })
      .map(() => {
        this.#logger.ready(`Connected to MCP server ${this.name} at ${url}`)
        return true
      })
      .mapErr((err) => {
        this.#logger.error(`Failed to connect to MCP server ${this.name} at ${url}:`, err)
        return err
      })

    return this.#isConnected
  }

  async [Symbol.asyncDispose]() {
    if (!this.#transport) {
      this.#logger.info('Dispose called but transport was not connected')
      return
    }
    this.#logger.debug('Disposing client and closing transport')

    this.#isConnected = ResultAsync.fromPromise(this.#transport.close(), (e) => e)
      .andTee(() => {
        this.#transport = undefined
      })
      .map(() => {
        this.#logger.debug('Transport closed successfully')
        return false
      })
      .mapErr((err) => {
        this.#logger.error('Error during transport close:', err)
        return err
      })

    await this.#isConnected
  }

  disconnect() {
    return this[Symbol.asyncDispose]()
  }

  listTools() {
    this.tools = this.connect()
      .andThen(ResultAsync.fromThrowable(() => this.#client.listTools(undefined, { timeout: this.#timeout })))
      .mapErr((err) => {
        this.#logger.error('Error listing tools:', err)
        this.tools = undefined
        return err
      })
      .map((res) => {
        if (!this.#isTrusted) {
          for (const tool of res.tools) {
            delete tool._meta
            delete tool.annotations
          }
        }
        return res.tools
      })
    return this.tools
  }

  callTool(params: CallToolRequest['params'], options?: { signal?: AbortSignal }) {
    return this.connect()
      .map(() => {
        this.#logger.debug(`Calling tool ${params.name}`, { params })
      })
      .andThen(
        ResultAsync.fromThrowable(() =>
          this.#client.callTool(params, undefined, {
            timeout: this.#timeout,
            resetTimeoutOnProgress: true,
            onprogress: this.#onProgress,
            signal: options?.signal,
          }),
        ),
      )
  }

  setSamplingHandler(handler: (params: SamplingRequest['params']) => ResultAsync<SamplingResult, unknown>) {
    return this.connect().map(() => {
      this.#logger.debug(`Setting sampling handler for server ${this.name}:`, handler.toString())
      this.#client.setRequestHandler(SamplingRequestSchema, async ({ params }) => {
        const res = await handler(params)
        if (res.isErr()) {
          throw res.error
        }
        return res.value
      })
    })
  }

  setElicitationHandler(handler: (params: ElicitRequest['params']) => ResultAsync<ElicitResult, unknown>) {
    return this.connect().map(() => {
      this.#logger.debug(`Setting elicitation handler for server ${this.name}:`, handler.toString())
      this.#client.setRequestHandler(ElicitRequestSchema, async ({ params }) => {
        const res = await handler(params)
        if (res.isErr()) {
          throw res.error
        }
        return res.value
      })
    })
  }

  setLogHandler(handler: (params: LoggingMessageNotification['params']) => ResultAsync<void, unknown>) {
    return this.connect().map(() => {
      this.#logger.debug(`Setting log handler for server ${this.name}:`, handler.toString())
      this.#client.setNotificationHandler(LoggingMessageNotificationSchema, async ({ params }) => {
        const res = await handler(params)
        if (res.isErr()) {
          throw res.error
        }
        return res.value
      })
    })
  }
}
