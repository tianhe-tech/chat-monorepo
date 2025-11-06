import { MCPMessageChannel, type MCPMessageChannelString } from '@th-chat/shared/types'
import { PubSub, type ValkeyAddresses } from '@th-chat/shared/utils'
import type { DomainMediator } from '../domain/mediator'
import type { ConsolaInstance } from 'consola'
import { ResultAsync } from 'neverthrow'
import destr from 'destr'
import * as Contract from '@th-chat/shared/contracts/chat-mcp-hub'

type CtorParams = {
  pubsub: PubSub<MCPMessageChannelString>
}

type FactoryParams = {
  mediator: DomainMediator
  logger: ConsolaInstance
  valkeyAddresses: ValkeyAddresses
}

export class ValkeyMCPHubComm implements AsyncDisposable {
  #pubsub: CtorParams['pubsub']

  private constructor({ pubsub }: CtorParams) {
    this.#pubsub = pubsub
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#pubsub.close()
  }

  static create({ mediator, logger, valkeyAddresses }: FactoryParams): ResultAsync<ValkeyMCPHubComm, Error> {
    const createPubSub = ResultAsync.fromPromise(
      PubSub.new<MCPMessageChannelString>({
        channels: [
          MCPMessageChannel.ElicitationRequest,
          MCPMessageChannel.SamplingRequest,
          MCPMessageChannel.Progress,
          MCPMessageChannel.ToolCallResult,
        ],
        valkeyAddresses,
        logTag: 'MCPHubPubSub',
        subCallback: ({ channel, message }) => {
          switch (channel) {
            case MCPMessageChannel.ElicitationRequest:
              recvElicitationRequest(mediator, message)
              break
            case MCPMessageChannel.SamplingRequest:
              recvSamplingRequest(mediator, message)
              break
            case MCPMessageChannel.Progress:
              recvProgress(mediator, message)
              break
            case MCPMessageChannel.ToolCallResult:
              recvToolCallResult(mediator, message)
              break
            default:
              logger.warn(`Received message on unexpected channel: ${channel}`)
          }
        },
      }),
      () => new Error('Failed to create PubSub for ValkeyMCPHubComm'),
    )

    return createPubSub.map((pubsub) => {
      forwardElicitationResult(mediator, pubsub)
      forwardSamplingResult(mediator, pubsub)
      return new ValkeyMCPHubComm({ pubsub })
    })
  }
}

function recvElicitationRequest(mediator: DomainMediator, message: string): void {
  const de = destr(message)
  const { success, data, error } = Contract.elicitationRequestSchema.safeParse(de)
  if (!success) {
    throw error
  }
  mediator.emit('mcpToolElicitationRequest', data)
}

function recvSamplingRequest(mediator: DomainMediator, message: string): void {
  const de = destr(message)
  const { success, data, error } = Contract.samplingRequestSchema.safeParse(de)
  if (!success) {
    throw error
  }
  mediator.emit('mcpToolSamplingRequest', data)
}

function recvProgress(mediator: DomainMediator, message: string): void {
  const de = destr(message)
  const { success, data, error } = Contract.progressSchema.safeParse(de)
  if (!success) {
    throw error
  }
  mediator.emit('mcpToolProgress', data)
}

function recvToolCallResult(mediator: DomainMediator, message: string): void {
  const de = destr(message)
  const { success, data, error } = Contract.toolCallResultSchema.safeParse(de)
  if (!success) {
    throw error
  }
  mediator.emit('mcpToolCallResult', data)
}

function forwardElicitationResult(mediator: DomainMediator, pubsub: PubSub<MCPMessageChannelString>): void {
  mediator.on('mcpToolElicitationResult', (data) => {
    const msg = Contract.elicitationResultSchema.parse(data)
    pubsub.publish({ channel: MCPMessageChannel.ElicitationResult, message: JSON.stringify(msg) })
  })
}

function forwardSamplingResult(mediator: DomainMediator, pubsub: PubSub<MCPMessageChannelString>): void {
  mediator.on('mcpToolSamplingResult', (data) => {
    const msg = Contract.samplingResultSchema.parse(data)
    pubsub.publish({ channel: MCPMessageChannel.SamplingResult, message: JSON.stringify(msg) })
  })
}
