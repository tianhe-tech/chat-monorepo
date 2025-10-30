import ky, { type KyInstance } from 'ky'
import type { MCPHubAPI } from '../domain/port/mcp-hub-api'
import type { Tool, CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ResultAsync } from 'neverthrow'
import type { ConsolaInstance } from 'consola'

export class RestMCPHubAPI implements MCPHubAPI {
  #ky: KyInstance
  #logger: ConsolaInstance
  #threadId: string

  constructor(props: { baseURL: string; logger: ConsolaInstance; threadId: string }) {
    this.#logger = props.logger
    this.#ky = ky.create({ prefixUrl: props.baseURL })
    this.#threadId = props.threadId
  }

  listAllTools(options: { signal?: AbortSignal } = {}): ResultAsync<Tool[], Error> {
    this.#logger.debug('Fetching MCP tools')
    const { signal } = options
    return ResultAsync.fromPromise(
      this.#ky
        .get('tools', {
          headers: { 'mcp-thread-id': this.#threadId },
          signal,
        })
        .json<Tool[]>(),
      () => new Error('Failed to fetch MCP tools'),
    ).andTee((tools) => {
      this.#logger.debug('Fetched MCP tools:', tools)
    })
  }

  callTool(
    params: CallToolRequest['params'],
    options: { signal?: AbortSignal } = {},
  ): ResultAsync<CallToolResult, Error> {
    this.#logger.debug(`Calling MCP tool ${params.name} with params:`, params)
    const { signal } = options
    return ResultAsync.fromPromise(
      this.#ky
        .post('tools', {
          json: params,
          headers: { 'mcp-thread-id': this.#threadId },
          signal,
          timeout: 120_000,
        })
        .json<CallToolResult>(),
      () => new Error(`Failed to call MCP tool ${params.name}`),
    )
  }
}
