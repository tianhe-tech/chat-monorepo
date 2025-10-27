import EventEmitter from 'node:events'
import * as Contract from '@internal/shared/contracts/chat-mcp-hub'

export class DomainMediator extends EventEmitter<{
  toolCallResult: [Contract.ToolCallResult]
  progress: [Contract.Progress]
  samplingRequest: [Contract.SamplingRequest]
  samplingResult: [Contract.SamplingResult]
  elicitationRequest: [Contract.ElicitationRequest]
  elicitationResult: [Contract.ElicitationResult]
}> {}
