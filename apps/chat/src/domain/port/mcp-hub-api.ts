import type { CallToolRequest, CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type { ResultAsync } from 'neverthrow'

export interface MCPHubAPI {
  listAllTools(options?: { signal?: AbortSignal }): ResultAsync<Tool[], Error>
  callTool(params: CallToolRequest['params'], options?: { signal?: AbortSignal }): ResultAsync<CallToolResult, Error>
}
