import type { DynamicToolUIPart } from 'ai'
import EventEmitter from 'node:events'
import * as Contract from '@th-chat/shared/contracts/chat-mcp-hub'

export class DomainMediator extends EventEmitter<{
  mcpToolOutputAvailable: [DynamicToolUIPart]
  mcpToolOutputError: [DynamicToolUIPart]

  mcpToolCallResult: [Contract.ToolCallResult]
  mcpToolElicitationRequest: [Contract.ElicitationRequest]
  mcpToolElicitationResult: [Contract.ElicitationResult]
  mcpToolSamplingRequest: [Contract.SamplingRequest]
  mcpToolSamplingResult: [Contract.SamplingResult]
  mcpToolProgress: [Contract.Progress]
}> {}
