import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type {
  CallToolRequest,
  CallToolResult,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type { ResultAsync } from 'neverthrow'
import type { MCPServerConfig } from '../value-object/mcp-server-config'
import * as Contract from '@internal/shared/contracts/chat-mcp-hub'

export type SamplingHandler = (
  params: CreateMessageRequest['params'],
) => CreateMessageResult | Promise<CreateMessageResult>
export type ElicitationHandler = (params: ElicitRequest['params']) => ElicitResult | Promise<ElicitResult>

export interface MCPClient extends AsyncDisposable {
  connect(): ResultAsync<void, Error>
  listTools(): ResultAsync<Tool[], Error>
  callTool(params: Contract.ToolCallRequest['data'], options?: RequestOptions): ResultAsync<CallToolResult, Error>
  setSamplingHandler(handler: SamplingHandler): ResultAsync<void, Error>
  setElicitationHandler(handler: ElicitationHandler): ResultAsync<void, Error>
  getCurrenToolCallId(): string | undefined
}

export interface MCPClientCtor {
  new (config: MCPServerConfig): MCPClient
}
