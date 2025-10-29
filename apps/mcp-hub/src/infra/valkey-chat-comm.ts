import * as Contract from '@internal/shared/contracts/chat-mcp-hub'
import { MCPMessageChannel, type MCPMessageChannelString } from '@internal/shared/types'
import { PubSub, type ValkeyAddresses } from '@internal/shared/utils'
import { type ConsolaInstance } from 'consola'
import destr from 'destr'
import { ResultAsync } from 'neverthrow'
import type { DomainMediator } from '../domain/mediator'

type CtorParams = {
  pubsub: PubSub<MCPMessageChannelString>
}

type FactoryParams = {
  mediator: DomainMediator
  logger: ConsolaInstance
  valkeyAddresses: ValkeyAddresses
}

export class ValkeyChatComm implements AsyncDisposable {
  #pubsub: CtorParams['pubsub']

  private constructor({ pubsub }: CtorParams) {
    this.#pubsub = pubsub
  }

  static create({ logger, mediator, valkeyAddresses }: FactoryParams): ResultAsync<ValkeyChatComm, Error> {
    const createPubSub = ResultAsync.fromPromise(
      PubSub.new<MCPMessageChannelString>({
        channels: [MCPMessageChannel.SamplingResult, MCPMessageChannel.ElicitationResult],
        valkeyAddresses,
        logTag: 'MCPClientPubSub',
        subCallback: ({ channel, message }) => {
          switch (channel) {
            case MCPMessageChannel.SamplingResult:
              recvElicitationResult(mediator, message)
              break
            case MCPMessageChannel.ElicitationResult:
              recvSamplingResult(mediator, message)
              break
            default:
              logger.warn(`Unknown channel: ${channel}`)
              break
          }
        },
      }),
      () => new Error('Failed to create PubSub for ValkeyChatComm'),
    )

    return createPubSub.map((pubsub) => new ValkeyChatComm({ pubsub }))
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#pubsub.close()
  }
}

function recvElicitationResult(mediator: DomainMediator, message: string) {
  const de = destr(message)
  const { success, data, error } = Contract.elicitationResultSchema.safeParse(de)
  if (!success) {
    throw error
  }
  mediator.emit('elicitationResult', data)
}

function recvSamplingResult(mediator: DomainMediator, message: string) {
  const de = destr(message)
  const { success, data, error } = Contract.samplingResultSchema.safeParse(de)
  if (!success) {
    throw error
  }
  mediator.emit('samplingResult', data)
}
