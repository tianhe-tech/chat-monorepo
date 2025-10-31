import * as Contract from '@th-chat/shared/contracts/chat-mcp-hub'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type {
  CallToolResult,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type { ResultAsync } from 'neverthrow'
import type { MCPServerConfig } from '@th-chat/shared/contracts/mcp-server-config'

export type SamplingHandler = (
  params: CreateMessageRequest['params'],
) => CreateMessageResult | Promise<CreateMessageResult>
export type ElicitationHandler = (params: ElicitRequest['params']) => ElicitResult | Promise<ElicitResult>

export abstract class MCPClient implements AsyncDisposable {
  protected readonly serverConfig: MCPServerConfig
  constructor(config: MCPServerConfig) {
    this.serverConfig = config
  }
  abstract connect(): ResultAsync<void, Error>
  abstract listTools(): ResultAsync<Tool[], Error>
  abstract callTool(
    params: Contract.ToolCallRequest['data'],
    options?: RequestOptions,
  ): ResultAsync<CallToolResult, Error>
  abstract setSamplingHandler(handler: SamplingHandler): ResultAsync<void, Error>
  abstract setElicitationHandler(handler: ElicitationHandler): ResultAsync<void, Error>
  abstract getCurrenToolCallId(): string | undefined
  abstract [Symbol.asyncDispose](): Promise<void>
}
