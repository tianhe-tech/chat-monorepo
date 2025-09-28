import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js'
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  LoggingMessageNotificationSchema,
  type CallToolRequest,
  type CreateMessageRequest,
  type CreateMessageResult,
  type ElicitRequest,
  type ElicitResult,
  type LoggingMessageNotification,
  type Tool as MCPTool,
  type Prompt,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js'
import { consola, type ConsolaInstance } from 'consola'
import { colorize } from 'consola/utils'
import { asyncExitHook } from 'exit-hook'
import { goTryRaw } from 'go-go-try'
import { z } from 'zod'
import { env } from '../env'
import { MCPMessageBroker } from './message-broker'
import { MCPMessageChannels } from '.'

type MCPClientManagerOptions = {
  servers: Record<string, ServerDefinition>
  threadId: string
}

export const serverDefinitionSchema = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
})

export type ServerDefinition = z.infer<typeof serverDefinitionSchema>

type Awaitable<T> = T | Promise<T>

// TODO: connection and message broker lifetime management
export class MCPClientManager {
  readonly threadId: string
  readonly #serverConfigs: Record<string, ServerDefinition>
  readonly #mcpClientsByName = new Map<string, InternalMCPClient>()
  #logger: ConsolaInstance
  #disconnectPromise?: Promise<void>
  #setupPromise?: Promise<void>
  /**
   * Mapping of server names to their respective tools
   */
  #tools?: Promise<Record<string, MCPTool[]>>
  #messageBroker: MCPMessageBroker

  constructor({ servers, threadId }: MCPClientManagerOptions) {
    this.threadId = threadId
    this.#logger = consola.withTag(`MCPClientManager:${threadId}`)

    for (const server of Object.values(servers)) {
      const parsedServer = serverDefinitionSchema.parse(server)
      const url = new URL(parsedServer.url)
      const isTrusted = env.TRUSTED_MCP_ORIGINS.includes(url.origin)
      this.#logger.log(`Configured server ${url} as ${colorize('redBright', isTrusted ? 'trusted' : 'untrusted')}`)
    }
    this.#serverConfigs = servers

    this.#messageBroker = new MCPMessageBroker({ manager: this })
  }

  async setup() {
    if (this.#setupPromise === undefined) {
      this.#setupPromise = this.#messageBroker.setupSub().then(null)
    }
    return this.#setupPromise
  }

  async disconnect() {
    if (this.#disconnectPromise) {
      return this.#disconnectPromise
    }

    this.#disconnectPromise = (async () => {
      this.#messageBroker.dispose()
      await goTryRaw(Promise.all(Array.from(this.#mcpClientsByName.values()).map((client) => client.disconnect())))
      this.#disconnectPromise = undefined
    })()
  }

  async #getConnectedClientForServer(serverName: string) {
    const serverConfig = this.#serverConfigs[serverName]
    if (!serverConfig) {
      throw new Error(`No server configuration found for server name: ${serverName}`)
    }
    if (this.#disconnectPromise) {
      await this.#disconnectPromise
    }

    const existingClient = this.#mcpClientsByName.get(serverName)
    if (existingClient) {
      this.#logger.debug(`Reusing existing connected client for server: ${serverName}`)
      await existingClient.connect()
      return existingClient
    }

    this.#logger.debug(`Creating new client for server: ${serverName}`)
    const client = new InternalMCPClient({
      manager: this,
      messageBroker: this.#messageBroker,
      name: serverName,
      server: serverConfig,
      timeout: env.MCP_CACHE_TTL_MS / 2,
    })
    this.#mcpClientsByName.set(serverName, client)
    const [err] = await goTryRaw(client.connect())
    if (err) {
      this.#logger.error(`Error connecting to server ${serverName}:`, err)
      this.#mcpClientsByName.delete(serverName)
      throw err
    }
    return client
  }

  async fetchTools() {
    this.#tools = Promise.all(
      Object.keys(this.#serverConfigs).map(async (serverName) => {
        const client = await this.#getConnectedClientForServer(serverName)
        const tools = await client.listTools()

        return [serverName, tools]
      }),
    ).then(Object.fromEntries)
    return this.#tools
  }

  async listTools() {
    if (this.#tools) {
      return this.#tools
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

  async callTool(params: CallToolRequest['params'], options?: { signal?: AbortSignal }) {
    const { serverName, toolName } = this.destructToolName(params.name)
    const client = await this.#getConnectedClientForServer(serverName)
    return client.callTool({ ...params, name: toolName }, options)
  }

  async setSamplingHandlerForServer(
    serverName: string,
    handler: (params: CreateMessageRequest['params']) => Awaitable<CreateMessageResult>,
  ) {
    const client = await this.#getConnectedClientForServer(serverName)
    client.setSamplingHandler(handler)
  }

  async setElicitationHandlerForServer(
    serverName: string,
    handler: (params: ElicitRequest['params']) => Awaitable<ElicitResult>,
  ) {
    const client = await this.#getConnectedClientForServer(serverName)
    client.setElicitationHandler(handler)
  }

  async setSamplingHandler(
    handler: (params: CreateMessageRequest['params'] & { serverName: string }) => Awaitable<CreateMessageResult>,
  ) {
    this.#logger.verbose(`Setting sampling handler for all servers:`, handler.toString())
    const serverNames = Object.keys(this.#serverConfigs)
    await Promise.all(
      serverNames.map(async (serverName) => {
        await this.setSamplingHandlerForServer(serverName, (params) => handler({ ...params, serverName }))
      }),
    )
  }

  async setElicitationHandler(
    handler: (params: ElicitRequest['params'] & { serverName: string }) => Awaitable<ElicitResult>,
  ) {
    this.#logger.verbose(`Setting elicitation handler for all servers:`, handler.toString())
    const serverNames = Object.keys(this.#serverConfigs)
    await Promise.all(
      serverNames.map(async (serverName) => {
        await this.setElicitationHandlerForServer(serverName, (params) => handler({ ...params, serverName }))
      }),
    )
  }

  async setLogHandlerForServer(
    serverName: string,
    handler: (params: LoggingMessageNotification['params']) => Awaitable<void>,
  ) {
    const client = await this.#getConnectedClientForServer(serverName)
    client.setLogHandler(handler)
  }

  async setLogHandler(
    handler: (params: LoggingMessageNotification['params'] & { serverName: string }) => Awaitable<void>,
  ) {
    this.#logger.verbose('Setting log handler for all servers:', handler.toString())
    const serverNames = Object.keys(this.#serverConfigs)
    await Promise.all(
      serverNames.map(async (serverName) => {
        await this.setLogHandlerForServer(serverName, (params) => handler({ ...params, serverName }))
      }),
    )
  }
}

type InternalMCPClientOptions = {
  manager: MCPClientManager
  messageBroker: MCPMessageBroker
  name: string
  version?: string
  server: ServerDefinition
  timeout?: number
}

// TODO: resume connection
class InternalMCPClient {
  readonly name: string
  readonly #timeout: number
  readonly #isTrusted: boolean
  #manager: MCPClientManager
  #messageBroker: MCPMessageBroker
  #client: Client
  #serverConfig: ServerDefinition
  #transport?: StreamableHTTPClientTransport
  #isConnected?: Promise<boolean>
  #logger: ConsolaInstance
  resources?: Promise<Resource[]>
  prompts?: Promise<Prompt[]>
  tools?: Promise<MCPTool[]>

  constructor({
    manager,
    messageBroker,
    name,
    version = '0.0.1',
    server,
    timeout = DEFAULT_REQUEST_TIMEOUT_MSEC,
  }: InternalMCPClientOptions) {
    this.#manager = manager
    this.#messageBroker = messageBroker
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

    this.#logger = consola.withTag(`InternalMCPClient:${name}:${this.#manager.threadId}`)

    this.#isTrusted = env.TRUSTED_MCP_ORIGINS.includes(new URL(server.url).origin)

    this.#logger.debug('Instantiated')
  }

  async connect() {
    if (this.#isConnected !== undefined && (await this.#isConnected) === true) {
      return this.#isConnected
    }

    const { url, headers } = this.#serverConfig

    this.#isConnected = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers },
      })
      this.#transport = transport

      this.#logger.debug(`Attempting Streamable HTTP connection on URL: ${url}`)
      const [err] = await goTryRaw(this.#client.connect(transport, { timeout: 5_000 }))

      const originalOnClose = this.#client.onclose
      // oxlint-disable-next-line prefer-add-event-listener
      this.#client.onclose = () => {
        this.#logger.debug('Connection closed')
        this.#isConnected = Promise.resolve(false)
        originalOnClose?.()
      }

      if (err) {
        this.#logger.error(`Failed to connect to MCP server ${this.name} at ${url}:`, err)
        throw err
      }

      this.#logger.ready(`Connected to MCP server ${this.name} at ${url}`)
      this.#manager.setup()
      return true
    })()

    asyncExitHook(
      async () => {
        this.#logger.debug('Disconnecting during exit')
        await this.disconnect()
      },
      { wait: 5000 },
    )

    return this.#isConnected
  }

  async disconnect() {
    if (!this.#transport) {
      this.#logger.debug('Disconnect called but transport was not connected')
      return
    }
    this.#logger.debug('Disconnecting')

    const [err] = await goTryRaw(this.#transport.close())

    this.#transport = undefined
    this.#isConnected = Promise.resolve(false)

    if (err) {
      this.#logger.error('Error during transport close:', err)
      throw err
    }

    this.#logger.debug('Disconnected successfully')
  }

  async listTools() {
    this.tools = (async () => {
      await this.connect()
      const [err, res] = await goTryRaw(this.#client.listTools(undefined, { timeout: this.#timeout }))
      if (err) {
        this.#logger.error('Error listing tools:', err)
        this.tools = undefined
        throw err
      }

      if (!this.#isTrusted) {
        for (const tool of res.tools) {
          delete tool._meta
          delete tool.annotations
        }
      }

      return res.tools
    })()
    return this.tools
  }

  async callTool(params: CallToolRequest['params'], options?: { signal?: AbortSignal }) {
    await this.connect()
    this.#logger.debug(`Calling tool ${params.name}`, { params })
    const [err, result] = await goTryRaw(
      this.#client.callTool(params, undefined, {
        timeout: this.#timeout,
        resetTimeoutOnProgress: true,
        onprogress: (progress) => {
          this.#messageBroker.publish(
            { ...progress, progressToken: params._meta?.progressToken },
            MCPMessageChannels.Progress,
          )
        },
      }),
    )

    if (err) {
      this.#logger.error(err)
      throw err
    }

    this.#messageBroker.publish(
      { ...result, progressToken: params._meta?.progressToken },
      MCPMessageChannels.ToolCallResult,
    )

    return result
  }

  async setSamplingHandler(handler: (params: CreateMessageRequest['params']) => Awaitable<CreateMessageResult>) {
    await this.connect()
    this.#logger.debug(`Setting sampling handler for server ${this.name}:`, handler.toString())
    this.#client.setRequestHandler(CreateMessageRequestSchema, ({ params }) => handler(params))
  }

  async setElicitationHandler(handler: (params: ElicitRequest['params']) => Awaitable<ElicitResult>) {
    await this.connect()
    this.#logger.debug(`Setting elicitation handler for server ${this.name}:`, handler.toString())
    this.#client.setRequestHandler(ElicitRequestSchema, ({ params }) => handler(params))
  }

  async setLogHandler(handler: (params: LoggingMessageNotification['params']) => Awaitable<void>) {
    await this.connect()
    this.#logger.debug(`Setting log handler for server ${this.name}:`, handler.toString())
    this.#client.setNotificationHandler(LoggingMessageNotificationSchema, ({ params }) => handler(params))
  }
}
