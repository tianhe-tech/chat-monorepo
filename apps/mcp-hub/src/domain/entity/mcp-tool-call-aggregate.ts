import { err, ok, type Result } from 'neverthrow'
import { MCPToolCall, MCPToolCallStateError } from './mcp-tool-call'

export class MCPToolCallAggregate {
  #toolCalls = new Map<string, MCPToolCall>()
  readonly id: string

  constructor(id: string) {
    this.id = id
  }

  startToolCall(toolCallId: string, toolName: string): Result<void, MCPToolCallStateError> {
    if (this.#toolCalls.has(toolCallId)) {
      return err(new MCPToolCallStateError())
    }
    this.#toolCalls.set(toolCallId, new MCPToolCall(toolCallId, toolName))
    return ok()
  }

  getExistingToolCall(toolCallId: string): Result<MCPToolCall, MCPToolCallStateError> {
    const toolCall = this.#toolCalls.get(toolCallId)
    if (toolCall === undefined) {
      return err(new MCPToolCallStateError())
    }
    return ok(toolCall)
  }

  elicitationRequest(toolCallId: string) {
    return this.getExistingToolCall(toolCallId).andThrough((toolCall) => toolCall.elicitationRequest())
  }

  elicitationResult(toolCallId: string) {
    return this.getExistingToolCall(toolCallId).andThrough((toolCall) => toolCall.elicitationResult())
  }

  samplingRequest(toolCallId: string) {
    return this.getExistingToolCall(toolCallId).andThrough((toolCall) => toolCall.samplingRequest())
  }

  samplingResult(toolCallId: string) {
    return this.getExistingToolCall(toolCallId).andThrough((toolCall) => toolCall.samplingResult())
  }

  result(toolCallId: string) {
    return this.getExistingToolCall(toolCallId).andThrough((toolCall) => toolCall.result())
  }
}
