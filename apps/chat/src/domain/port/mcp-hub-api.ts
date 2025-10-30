import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type { ResultAsync } from 'neverthrow'
import * as Contract from '@internal/shared/contracts/chat-mcp-hub'

export interface MCPHubAPI {
  listAllTools(options?: { signal?: AbortSignal }): ResultAsync<Tool[], Error>
  callTool(
    params: Contract.ToolCallRequest['data'],
    options?: { signal?: AbortSignal },
  ): ResultAsync<CallToolResult, Error>
}
