import type { ToolCallRequest } from '@internal/shared/contracts/chat-mcp-hub'
import { Client } from '@modelcontextprotocol/sdk/client'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { CreateMessageRequestSchema, ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { consola, type ConsolaInstance } from 'consola'
import { ok, ResultAsync } from 'neverthrow'
import type { ElicitationHandler, MCPClient, SamplingHandler } from '../port/mcp-client'
import type { MCPServerConfig } from '../value-object/mcp-server-config'

export class MCPClientImpl implements MCPClient {
  #serverConfig: MCPServerConfig
  #client: Client
  #transport?: StreamableHTTPClientTransport | StdioClientTransport | SSEClientTransport
  #connectResult?: ResultAsync<void, Error>
  #logger: ConsolaInstance
  #currentToolCallId?: string

  constructor(config: MCPServerConfig) {
    this.#serverConfig = config
    this.#client = new Client(
      { name: config.value.name, version: '0.1.0' },
      {
        capabilities: {
          elicitation: {},
          sampling: {},
        },
      },
    )
    this.#logger = consola.withTag(`MCPClient:${config.value.name}`)
  }

  connect(): ResultAsync<void, Error> {
    if (this.#connectResult !== undefined) {
      return this.#connectResult.orElse(() => this.connect())
    }

    const config = this.#serverConfig.value
    const createTransport = () => {
      this.#transport = (() => {
        switch (config.transport) {
          case 'stdio':
            return new StdioClientTransport({
              command: config.command[0],
              args: config.command.slice(1),
            })
          case 'sse':
            return new SSEClientTransport(new URL(config.url), { requestInit: config.requestInit })
          case 'streamable_http':
            return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: config.requestInit })
        }
      })()
      return ok(this.#transport)
    }

    this.#connectResult = createTransport()
      .asyncAndThen((transport) => {
        const originalOnClose = this.#client.onclose
        this.#client.onclose = () => {
          this.#logger.info('Connection closed')
          this.#connectResult = undefined
          originalOnClose?.()
        }

        return ResultAsync.fromPromise(
          this.#client.connect(transport, { timeout: 5000 }),
          () => new Error('MCP connection error'),
        )
      })
      .andTee(() => {
        this.#logger.ready(`Connected to MCP Server ${this.#serverConfig.value}`)
      })
      .orTee(() => {
        this.#logger.error(`Failed to connect to MCP server ${this.#serverConfig.value.name}`)
      })

    return this.#connectResult
  }

  listTools(): ResultAsync<Tool[], Error> {
    return ResultAsync.fromPromise(
      this.#client.listTools(),
      (e) => new Error(`Failed to list tools: ${e instanceof Error ? e.message : String(e)}`),
    ).map((result) => result.tools)
  }

  callTool(params: ToolCallRequest['data'], options?: RequestOptions): ResultAsync<CallToolResult, Error> {
    return this.connect().andThen(() => {
      const prevToolCallId = this.#currentToolCallId
      this.#currentToolCallId = params.toolCallId
      // Extract only the parameters needed for the tool call, not the toolCallId
      const { toolCallId: _, ...toolParams } = params

      return ResultAsync.fromPromise(
        this.#client.callTool(toolParams, undefined, options).finally(() => {
          this.#currentToolCallId = prevToolCallId
        }) as Promise<CallToolResult>,
        (e) => new Error(`Failed to call tool: ${e instanceof Error ? e.message : String(e)}`),
      )
    })
  }

  setSamplingHandler(handler: SamplingHandler): ResultAsync<void, Error> {
    return this.connect().map(() => {
      this.#client.setRequestHandler(CreateMessageRequestSchema, ({ params }) => handler(params))
    })
  }

  setElicitationHandler(handler: ElicitationHandler): ResultAsync<void, Error> {
    return this.connect().map(() => {
      this.#client.setRequestHandler(ElicitRequestSchema, ({ params }) => handler(params))
    })
  }

  getCurrenToolCallId(): string | undefined {
    return this.#currentToolCallId
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.#transport) {
      this.#logger.info('Dispose called but transport was not connected')
      return
    }
    this.#logger.debug('Disposing client and closing transport')

    this.#connectResult = ResultAsync.fromPromise(
      this.#transport.close().finally(() => {
        this.#transport = undefined
      }),
      (e) => new Error('Transport close error'),
    )
      .andTee(() => {
        this.#logger.info('Transport closed successfully')
      })
      .orTee((err) => {
        this.#logger.error('Error during transport close:', err)
      })

    // Wait for the close operation but return void
    await this.#connectResult
  }
}
