import * as Contract from '@internal/shared/contracts/chat-mcp-hub'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type {
  CallToolRequest,
  CallToolResult,
  CreateMessageResult,
  ElicitResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type { ConsolaInstance } from 'consola'
import { err, ok, Result, ResultAsync } from 'neverthrow'
import pTimeout from 'p-timeout'
import { MCPToolCallAggregate } from '../entity/mcp-tool-call-aggregate'
import type { DomainMediator } from '../mediator'
import type { MCPClient } from '../port/mcp-client'
import type { MCPServerConfig } from '@internal/shared/contracts/mcp-server-config'

export class InvalidInputError extends Error {}

type MCPServerName = string
type ToolCallId = string

type MCPHubServiceCtorParams = {
  id: string
  servers: MCPServerConfig[]
  logger: ConsolaInstance
  mediator: DomainMediator
  mcpClientFactory: (config: MCPServerConfig) => MCPClient
}

export class MCPHubService implements AsyncDisposable {
  readonly id: string
  #serverConfigs: Map<MCPServerName, MCPServerConfig>
  #logger: ConsolaInstance
  #toolCallAggregate: MCPToolCallAggregate
  #mediator: DomainMediator
  #mcpClientFactory: MCPHubServiceCtorParams['mcpClientFactory']

  #mcpClients = new Map<MCPServerName, MCPClient>()
  #samplingResolvers = new Map<ToolCallId, (result: CreateMessageResult) => void>()
  #elicitationResolvers = new Map<ToolCallId, (result: ElicitResult) => void>()
  readonly disposableStack = new AsyncDisposableStack()

  constructor({ id, servers, logger, mcpClientFactory, mediator }: MCPHubServiceCtorParams) {
    this.id = id
    this.#serverConfigs = new Map(servers.map((server) => [server.name, server]))
    this.#logger = logger
    this.#mcpClientFactory = mcpClientFactory
    this.#toolCallAggregate = new MCPToolCallAggregate(id)
    this.#mediator = mediator
    this.#handleElicitationResult()
    this.#handleSamplingResult()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await Promise.allSettled(
      Array.from(
        this.#mcpClients.entries().map(([key, client]) => {
          client[Symbol.asyncDispose]()
          this.#mcpClients.delete(key)
        }),
      ),
    )
    await this.disposableStack.disposeAsync()
  }

  #getClientOfServer(serverName: string): Result<MCPClient, Error> {
    const serverConfig = this.#serverConfigs.get(serverName)
    if (!serverConfig) {
      return err(new InvalidInputError(`Server config not found: ${serverName}`))
    }

    const existingClient = this.#mcpClients.get(serverName)
    if (existingClient) {
      this.#logger.debug(`Reusing existing MCP client for server: ${serverName}`)
      return ok(existingClient)
    }
    this.#logger.debug(`Creating new MCP client for server: ${serverName}`)
    const newClient = this.#mcpClientFactory(serverConfig)
    this.#mcpClients.set(serverName, newClient)
    this.#setupSamplingForClient(newClient)
    this.#setupElicitationForClient(newClient)
    return ok(newClient)
  }

  listToolsOfServer(serverName: string): ResultAsync<Tool[], Error> {
    return this.#getClientOfServer(serverName).asyncAndThen((client) => client.listTools())
  }

  listToolsByServer(): ResultAsync<Record<string, Tool[]>, Error> {
    return ResultAsync.combine(
      Array.from(
        this.#serverConfigs
          .keys()
          .map((serverName) => this.listToolsOfServer(serverName).map((tools) => [serverName, tools] as const)),
      ),
    ).map((entries) => Object.fromEntries(entries))
  }

  listAllTools(): ResultAsync<Tool[], Error> {
    return ResultAsync.combine(
      Array.from(
        this.#serverConfigs.keys().map((serverName) =>
          this.listToolsOfServer(serverName).map((tools) =>
            tools.map((tool) => ({
              ...tool,
              name: Contract.qualifiedToolNameSchema.encode({ serverName, toolName: tool.name }),
            })),
          ),
        ),
      ),
    ).map((nestedTools) => nestedTools.flat())
  }

  callTool(
    toolCallId: ToolCallId,
    params: CallToolRequest['params'],
    options?: Omit<RequestOptions, 'onprogress'>,
  ): ResultAsync<CallToolResult, Error> {
    return this.#toolCallAggregate.startToolCall(toolCallId, params.name).asyncAndThen(() => {
      const { serverName, toolName } = Contract.qualifiedToolNameSchema.decode(params.name)
      return this.#getClientOfServer(serverName)
        .asyncAndThen((client) =>
          client.callTool(
            { ...params, name: toolName, toolCallId },
            {
              ...options,
              onprogress: (progress) =>
                this.#mediator.emit('progress', { id: this.id, data: { ...progress, toolCallId } }),
            },
          ),
        )
        .andTee((result) =>
          this.#toolCallAggregate.result(toolCallId).map(() => {
            this.#mediator.emit('toolCallResult', {
              id: this.id,
              data: {
                ...result,
                toolCallId,
              },
            })
          }),
        )
    })
  }

  #handleSamplingResult() {
    this.#mediator.on('samplingResult', ({ id, data }) => {
      if (id !== this.id) {
        return
      }
      const state = this.#toolCallAggregate.samplingResult(data.toolCallId)
      if (state.isErr()) {
        this.#logger.error('Received sampling result, but we are in a bad state.')
        return
      }
      this.#samplingResolvers.get(data.toolCallId)?.(data)
    })
  }

  #setupSamplingForClient(client: MCPClient) {
    client.setSamplingHandler((params) => {
      const currentToolCallId = client.getCurrenToolCallId()

      if (!currentToolCallId) {
        const message = 'No current tool call ID found for sampling request'
        this.#logger.error(message)
        throw new Error(message)
      }

      const state = this.#toolCallAggregate.samplingRequest(currentToolCallId)
      if (state.isErr()) {
        this.#logger.error('Received sampling request, but we are in a bad state.')
        throw state.error
      }

      this.#mediator.emit('samplingRequest', {
        id: this.id,
        data: {
          ...params,
          toolCallId: currentToolCallId,
        },
      })

      return pTimeout(
        new Promise((resolve) => {
          this.#samplingResolvers.set(currentToolCallId, (result) => {
            resolve(result)
            this.#samplingResolvers.delete(currentToolCallId)
          })
        }),
        {
          milliseconds: 60000,
        },
      )
    })
  }

  #handleElicitationResult() {
    this.#mediator.on('elicitationResult', ({ id, data }) => {
      if (id !== this.id) {
        return
      }
      const state = this.#toolCallAggregate.elicitationResult(data.toolCallId)
      if (state.isErr()) {
        this.#logger.error('Received elicitation result, but we are in a bad state.')
        return
      }
      this.#elicitationResolvers.get(data.toolCallId)?.(data)
    })
  }

  #setupElicitationForClient(client: MCPClient) {
    client.setElicitationHandler((params) => {
      const currentToolCallId = client.getCurrenToolCallId()

      if (!currentToolCallId) {
        const message = 'No current tool call ID found for elicitation request'
        this.#logger.error(message)
        throw new Error(message)
      }

      const state = this.#toolCallAggregate.elicitationRequest(currentToolCallId)
      if (state.isErr()) {
        this.#logger.error('Received elicitation request, but we are in a bad state.')
        throw state.error
      }

      this.#mediator.emit('elicitationRequest', {
        id: this.id,
        data: {
          ...params,
          toolCallId: currentToolCallId,
        },
      })

      return pTimeout(
        new Promise((resolve) => {
          this.#elicitationResolvers.set(currentToolCallId, (result) => {
            resolve(result)
            this.#elicitationResolvers.delete(currentToolCallId)
          })
        }),
        {
          milliseconds: 60000,
        },
      )
    })
  }
}
