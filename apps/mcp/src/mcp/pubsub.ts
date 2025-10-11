import {
  ElicitResultSchema,
  CreateMessageResultSchema as SamplingResultSchema,
  type ElicitResult,
  type CreateMessageResult as SamplingResult,
} from '@modelcontextprotocol/sdk/types.js'
import { MCPMessageChannel, type MCPMessageChannelString } from '@repo/shared/types'
import { PubSub, type ValkeyAddresses } from '@repo/shared/utils'
import { consola, type ConsolaInstance } from 'consola'
import { destr } from 'destr'
import { ResultAsync } from 'neverthrow'
import { EventEmitter } from 'node:events'
import { z as z3 } from 'zodv3'
import type { MCPClientManager } from './client'
import { colorize } from 'consola/utils'

export type MCPClientPubSubCoordinatorFactoryOptions = {
  valkeyAddresses: ValkeyAddresses
  id: string
  clientManager: MCPClientManager
}

type MCPClientPubSubCoordinatorConstructorOptions = Omit<
  MCPClientPubSubCoordinatorFactoryOptions,
  'valkeyAddresses'
> & {
  pubsub: PubSub<MCPMessageChannelString>
  timeout?: number
}

export class MCPClientPubSubCoordinator
  extends EventEmitter<{
    error: unknown[]
    elicitationResult: [ElicitResult]
    samplingResult: [SamplingResult]
  }>
  implements AsyncDisposable
{
  #logger: ConsolaInstance
  #id: string
  #manager: MCPClientManager
  #pubsub: MCPClientPubSubCoordinatorConstructorOptions['pubsub']
  #publish: (channel: MCPMessageChannelString, data: object) => Promise<number>
  #timeout: number

  private constructor({
    id,
    clientManager,
    pubsub,
    timeout = 5 * 60_000,
  }: MCPClientPubSubCoordinatorConstructorOptions) {
    super()
    this.#id = id
    this.#manager = clientManager
    this.#pubsub = pubsub
    this.#logger = consola.withTag(`MCPClientPubSub:${id}`)
    this.#timeout = timeout

    this.#publish = (channel, data) => pubsub.publish({ channel, message: JSON.stringify({ data, id }) })

    this.on('error', (err) => {
      this.#logger.error('Error event emitted:', err)
    })
    this.#handleSamplingRequest()
    this.#handleElicitationRequest()
    this.#handleProgress()
    this.#handleToolCallResult()
  }

  static new({ id, clientManager, valkeyAddresses }: MCPClientPubSubCoordinatorFactoryOptions) {
    let local = {
      handleSamplingResult: (_m: string) => {},
      handleElicitationResult: (_m: string) => {},
      logger: consola.withTag(colorize('redBright', `!!Uninitialized:${id}!!`)),
    }

    const createPubSub = ResultAsync.fromPromise(
      PubSub.new<MCPMessageChannelString>({
        channels: [MCPMessageChannel.SamplingResult, MCPMessageChannel.ElicitationResult],
        valkeyAddresses,
        logTag: `MCPClientPubSub:${id}`,
        subCallback: ({ channel, message }) => {
          switch (channel) {
            case MCPMessageChannel.SamplingResult:
              local.handleSamplingResult(message)
              break
            case MCPMessageChannel.ElicitationResult:
              local.handleElicitationResult(message)
              break
            default:
              local.logger.warn(`Unknown channel: ${channel}`)
              break
          }
        },
      }),
      (e) => e,
    )

    return createPubSub.map((pubsub) => {
      const instance = new MCPClientPubSubCoordinator({ id, clientManager, pubsub })
      local = {
        handleSamplingResult: instance.#handleSamplingResult,
        handleElicitationResult: instance.#handleElicitationResult,
        logger: instance.#logger,
      }
      clientManager.useDisposable(instance)

      return instance
    })
  }

  close() {
    this.#pubsub.close()
    this.removeAllListeners()
  }

  async [Symbol.asyncDispose]() {
    this.close()
  }

  #handleProgress = () => {
    this.#manager.on('progress', (progress) => {
      this.#publish(MCPMessageChannel.Progress, progress)
    })
  }

  #handleToolCallResult = () => {
    this.#manager.on('toolCallResult', (result) => {
      this.#publish(MCPMessageChannel.ToolCallResult, result)
    })
  }

  #handleSamplingRequest = () => {
    return this.#manager.setSamplingHandler(
      ResultAsync.fromThrowable(async (params) => {
        const subCount = await this.#publish(MCPMessageChannel.SamplingRequest, params)

        if (subCount === 0) {
          throw new Error('Sampling request is not handled')
        }

        return new Promise<SamplingResult>((resolve, reject) => {
          const timeout = setTimeout(() => {
            const msg = 'Sampling request timed out'
            this.#logger.error(msg)
            this.off('samplingResult', listener)
            reject(new Error(msg))
          }, this.#timeout)

          const listener = (data: SamplingResult) => {
            clearTimeout(timeout)
            resolve(data)
          }
          this.once('samplingResult', listener)
        })
      }),
    )
  }

  #handleElicitationRequest = () => {
    return this.#manager.setElicitationHandler(
      ResultAsync.fromThrowable(async (params) => {
        const subCount = await this.#publish(MCPMessageChannel.ElicitationRequest, params)

        if (subCount === 0) {
          throw new Error('Elicitation request is not handled')
        }

        return new Promise<ElicitResult>((resolve, reject) => {
          const timeout = setTimeout(() => {
            const msg = 'Elicitation request timed out'
            this.#logger.error(msg, 'Cancelling')
            this.off('elicitationResult', listener)
            reject(new Error(msg))
          }, this.#timeout)

          const listener = (data: ElicitResult) => {
            clearTimeout(timeout)
            this.#logger.debug('sending elicitation result', data)
            resolve(data)
          }
          this.once('elicitationResult', listener)
        })
      }),
    )
  }

  #handleElicitationResult = (msg: string) => {
    const de = destr(msg)
    const { success, data: parsed, error } = z3.object({ id: z3.string(), data: ElicitResultSchema }).safeParse(de)
    if (!success) {
      const m = 'Invalid elicitation result received'
      this.#logger.error(m, error.message)
      throw new Error(m)
    }
    if (parsed.id === this.#id) {
      this.emit('elicitationResult', parsed.data)
    }
  }

  #handleSamplingResult = (msg: string) => {
    const de = destr(msg)
    const { success, data: parsed, error } = z3.object({ id: z3.string(), data: SamplingResultSchema }).safeParse(de)
    if (!success) {
      const m = 'Invalid sampling result received'
      this.#logger.error(m, error.message)
      throw new Error(m)
    }
    if (parsed.id === this.#id) {
      this.emit('samplingResult', parsed.data)
    }
  }
}
