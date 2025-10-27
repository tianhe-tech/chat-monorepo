import * as Contract from '@internal/shared/contracts/chat-mcp-hub'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { CallToolRequest, CreateMessageResult, ElicitResult } from '@modelcontextprotocol/sdk/types.js'
import type { ConsolaInstance } from 'consola'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import pTimeout from 'p-timeout'
import { MCPToolCallAggregate } from '../entity/mcp-tool-call-aggregate'
import type { DomainMediator } from '../mediator'
import type { MCPClient, MCPClientCtor } from '../port/mcp-client'
import type { MCPServerConfig } from '../value-object/mcp-server-config'

export class InvalidInputError extends Error {}

type MCPServerName = string
type ToolCallId = string

type MCPHubServiceCtorParams = {
  id: string
  servers: MCPServerConfig[]
  logger: ConsolaInstance
  MCPClientImpl: MCPClientCtor
  mediator: DomainMediator
}

export class MCPHubService implements AsyncDisposable {
  readonly id: string
  #serverConfigs: Map<MCPServerName, MCPServerConfig>
  #logger: ConsolaInstance
  #MCPClientImpl: MCPClientCtor
  #toolCallAggregate: MCPToolCallAggregate
  #mediator: DomainMediator

  #mcpClients = new Map<MCPServerName, MCPClient>()
  #samplingResolvers = new Map<ToolCallId, (result: CreateMessageResult) => void>()
  #elicitationResolvers = new Map<ToolCallId, (result: ElicitResult) => void>()

  constructor({ id, servers, logger, MCPClientImpl, mediator }: MCPHubServiceCtorParams) {
    this.id = id
    this.#serverConfigs = new Map(servers.map((server) => [server.value.name, server]))
    this.#logger = logger
    this.#MCPClientImpl = MCPClientImpl
    this.#toolCallAggregate = new MCPToolCallAggregate(id)
    this.#mediator = mediator
    this.#handleElicitationResult()
    this.#handleSamplingResult()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await Promise.allSettled(Array.from(this.#mcpClients.values().map((client) => client[Symbol.asyncDispose]())))
  }

  #getConnectedClientForServer(serverName: string) {
    const serverConfig = this.#serverConfigs.get(serverName)
    if (!serverConfig) {
      return errAsync(new InvalidInputError(`Server config not found: ${serverName}`))
    }

    const getOrCreateClient = () => {
      const existingClient = this.#mcpClients.get(serverName)
      if (existingClient) {
        this.#logger.debug(`Reusing existing MCP client for server: ${serverName}`)
        return okAsync(existingClient)
      }
      this.#logger.debug(`Creating new MCP client for server: ${serverName}`)
      const newClient = new this.#MCPClientImpl(serverConfig)
      this.#mcpClients.set(serverName, newClient)
      this.#setupSamplingForClient(newClient)
      this.#setupElicitationForClient(newClient)
      return okAsync(newClient)
    }

    return getOrCreateClient()
      .andThen((client) => client.connect().map(() => client))
      .orTee(() => {
        this.#mcpClients.delete(serverName)
      })
  }

  listToolsOfServer(serverName: string) {
    return this.#getConnectedClientForServer(serverName).andThen((client) => client.listTools())
  }

  listToolsByServer() {
    return ResultAsync.combine(
      Array.from(
        this.#serverConfigs
          .keys()
          .map((serverName) => this.listToolsOfServer(serverName).map((tools) => [serverName, tools])),
      ),
    ).map(Object.fromEntries)
  }

  listAllTools() {
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

  callTool(toolCallId: ToolCallId, params: CallToolRequest['params'], options?: RequestOptions) {
    return this.#toolCallAggregate.startToolCall(toolCallId, params.name).asyncAndThen(() => {
      const { serverName, toolName } = Contract.qualifiedToolNameSchema.decode(params.name)
      return this.#getConnectedClientForServer(serverName)
        .andThen((client) => client.callTool({ ...params, name: toolName, toolCallId }, options))
        .andTee((result) =>
          this.#mediator.emit('toolCallResult', {
            id: this.id,
            data: {
              ...result,
              toolCallId,
            },
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
        this.#logger.error('Failed to update tool call state for sampling result')
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
        this.#logger.error('Failed to update tool call state for sampling request')
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
        this.#logger.error('Failed to update tool call state for elicitation result')
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
        this.#logger.error('Failed to update tool call state for elicitation request')
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
