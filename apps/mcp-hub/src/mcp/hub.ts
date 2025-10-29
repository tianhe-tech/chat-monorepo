import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DEFAULT_REQUEST_TIMEOUT_MSEC, type ProgressCallback } from '@modelcontextprotocol/sdk/shared/protocol.js'
import {
  ElicitRequestSchema,
  LoggingMessageNotificationSchema,
  CreateMessageRequestSchema as SamplingRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type ElicitRequest,
  type ElicitResult,
  type LoggingMessageNotification,
  type Tool as MCPTool,
  type Progress,
  type Prompt,
  type Resource,
  type CreateMessageRequest as SamplingRequest,
  type CreateMessageResult as SamplingResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { MCPServerDefinition } from '@internal/shared/types'
import { consola, type ConsolaInstance } from 'consola'
import { ResultAsync, ok, okAsync } from 'neverthrow'
import EventEmitter from 'node:events'
import { env } from '../app/env'
import * as Contract from '@internal/shared/contracts/chat-mcp-hub'

type MCPClientManagerOptions = {
  servers: Record<string, MCPServerDefinition>
}

type MCPServerName = string

export class MCPClientManager extends EventEmitter<{
  error: unknown[]
  progress: [Progress]
  toolCallResult: [CallToolResult]
}> {
  readonly #serverConfigs: Record<MCPServerName, MCPServerDefinition>
  readonly #mcpClients = new Map<MCPServerName, InternalMCPClient>()
  readonly #logger: ConsolaInstance
  #tools?: ResultAsync<Record<MCPServerName, MCPTool[]>, unknown>
  readonly #disposableStack = new AsyncDisposableStack()

  constructor({ servers }: Pick<MCPClientManagerOptions, 'servers'>) {
    super()
    this.#serverConfigs = servers
    this.#logger = consola.withTag('MCPClientManager')
    this.on('error', (err) => {
      this.#logger.error('Error event emitted:', err)
    })
  }

  useDisposable(disposable: AsyncDisposable | Disposable) {
    this.#disposableStack.use(disposable)
  }

  async close() {
    await this.#disposableStack.disposeAsync()
  }

  async [Symbol.asyncDispose]() {
    await this.close()
  }

  #getConnectedClientForServer(serverName: string) {
    const serverConfig = this.#serverConfigs[serverName]
    if (!serverConfig) {
      throw new Error(`No server configuration found for server name: ${serverName}`)
    }

    const handleConnectionError = (err: unknown) => {
      this.#logger.error(`Error connecting to server ${serverName}:`, err)
      this.#mcpClients.delete(serverName)
      return err
    }

    const getConnectedClient = (client: InternalMCPClient) =>
      client
        .connect()
        .mapErr(handleConnectionError)
        .map(() => client)

    const existingClient = this.#mcpClients.get(serverName)
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
        this.emit('progress', progress)
      },
    })
    this.#mcpClients.set(serverName, client)
    this.#disposableStack.use(client)

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

  callTool(params: CallToolRequest['params'], options?: { signal?: AbortSignal }) {
    const { serverName, toolName } = qualifiedToolNameSchema.decode(params.name)
    return this.#getConnectedClientForServer(serverName).andThen((client) =>
      client
        .callTool({ ...params, name: toolName }, options)
        .andTee((result) => this.emit('toolCallResult', { ...result, _meta: params._meta } as CallToolResult)),
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

    const createTransport = () => {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers },
      })
      this.#transport = transport

      return ok(transport)
    }

    this.#isConnected = createTransport()
      .asyncAndThen((transport) => {
        this.#logger.debug(`Attempting Streamable HTTP connection on URL: ${url}`)

        const originalOnClose = this.#client.onclose
        // oxlint-disable-next-line prefer-add-event-listener
        this.#client.onclose = () => {
          this.#logger.debug('Connection closed')
          this.#isConnected = okAsync(false)
          originalOnClose?.()
        }

        return ResultAsync.fromPromise(this.#client.connect(transport, { timeout: 5_000 }), (e) => e)
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
    await this.close()
  }

  close() {
    if (!this.#transport) {
      this.#logger.info('Dispose called but transport was not connected')
      return okAsync(true)
    }
    this.#logger.debug('Disposing client and closing transport')

    this.#isConnected = ResultAsync.fromPromise(
      this.#transport.close().finally(() => {
        this.#transport = undefined
      }),
      (e) => e,
    )
      .map(() => {
        this.#logger.debug('Transport closed successfully')
        return false
      })
      .mapErr((err) => {
        this.#logger.error('Error during transport close:', err)
        return err
      })

    return this.#isConnected
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
      .andTee(() => {
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
