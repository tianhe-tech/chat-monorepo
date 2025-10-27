import type { ToolCallRequest } from '@internal/shared/contracts/chat-mcp-hub'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { errAsync, ok, okAsync, ResultAsync } from 'neverthrow'
import type { ElicitationHandler, MCPClient, MCPClientCtor, SamplingHandler } from '../port/mcp-client'
import type { MCPServerConfig } from '../value-object/mcp-server-config'
import assert from 'node:assert'
import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { consola, type ConsolaInstance } from 'consola'

export class MCPClientImpl implements MCPClient {
  #serverConfig: MCPServerConfig
  #client: Client
  #transport?: StreamableHTTPClientTransport | StdioClientTransport | SSEClientTransport
  #isConnected?: ResultAsync<boolean, Error>
  #logger: ConsolaInstance

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
    if (this.#isConnected !== undefined) {
      return this.#isConnected
        .andThen((isConnected) => (isConnected ? ok() : this.connect()))
        .orElse(() => this.connect())
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

    this.#isConnected = createTransport()
      .asyncAndThen((transport) => {
        const originalOnClose = this.#client.onclose
        this.#client.onclose = () => {
          this.#logger.debug('Connection closed')
          this.#isConnected = okAsync(false)
          originalOnClose?.()
        }

        return ResultAsync.fromPromise(
          this.#client.connect(transport, { timeout: 5000 }),
          (e) => new Error('MCP connection error'),
        )
      })
      .map(() => {
        this.#logger.ready(`Connected to MCP Server ${this.#serverConfig.value}`)
        return true
      })
      .orTee((err) => {
        this.#logger.error(`Failed to connect to MCP server ${this.#serverConfig.value.name}`)
      })

    return this.#isConnected.map(() => {})
  }

  listTools(): ResultAsync<Tool[], Error> {
    throw new Error('Method not implemented.')
  }
  callTool(params: ToolCallRequest['data'], options?: RequestOptions): ResultAsync<CallToolResult, Error> {
    throw new Error('Method not implemented.')
  }
  setSamplingHandler(handler: SamplingHandler): ResultAsync<void, Error> {
    throw new Error('Method not implemented.')
  }
  setElicitationHandler(handler: ElicitationHandler): ResultAsync<void, Error> {
    throw new Error('Method not implemented.')
  }
  getCurrenToolCallId(): string | undefined {
    throw new Error('Method not implemented.')
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.#transport) {
      this.#logger.info('Dispose called but transport was not connected')
      await okAsync(true)
      return
    }
    this.#logger.debug('Disposing client and closing transport')

    this.#isConnected = ResultAsync.fromPromise(
      this.#transport.close().finally(() => {
        this.#transport = undefined
      }),
      (e) => new Error('Transport close error'),
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
}
