import {
  ElicitResultSchema,
  CreateMessageResultSchema as SamplingResultSchema,
  type ElicitResult,
  type CreateMessageResult as SamplingResult,
} from '@modelcontextprotocol/sdk/types.js'
import { GlideClient, GlideClientConfiguration } from '@valkey/valkey-glide'
import { consola, type ConsolaInstance } from 'consola'
import { destr } from 'destr'
import exitHook, { asyncExitHook } from 'exit-hook'
import EventEmitter from 'node:events'
import { z as z3 } from 'zodv3'
import { env } from '../env'
import type { MCPClientManager } from './client'
import { MCPMessageChannels } from '.'

const pubConn = await GlideClient.createClient({
  addresses: env.VALKEY_ADDRESSES,
  lazyConnect: true,
})

exitHook(() => {
  pubConn.close()
})

export interface SamplingMetadata {
  includeContext?: {
    tools?: string[]
  }
  stream?: boolean
}

export class MCPMessageBroker extends EventEmitter<{
  samplingResult: [SamplingResult]
  elicitationResult: [ElicitResult]
  error: unknown[]
}> {
  #manager: MCPClientManager
  #logger: ConsolaInstance
  #sub?: Promise<GlideClient>

  constructor({ manager }: { manager: MCPClientManager }) {
    super()

    // According to nodejs doc, it's best practice to always listen to 'error' event on EventEmitter
    this.on('error', (err) => {
      this.#logger.error('Error event in MCPMessageBroker:', err)
    })

    this.#manager = manager
    this.#logger = consola.withTag(`MCPMessageBroker:${manager.threadId}`)

    asyncExitHook(
      async () => {
        await this.dispose()
      },
      { wait: 5000 },
    )
  }

  async dispose() {
    if (!this.#sub) {
      return
    }

    const conn = await this.#sub
    this.#logger.debug('Disposing MCPMessageBroker...')
    conn.close()
    this.#sub = undefined
  }

  async publish(data: object, channel: (typeof MCPMessageChannels)[keyof typeof MCPMessageChannels]) {
    this.#logger.debug(`Publishing to ${channel}:`, data)
    const subCount = await pubConn.publish(JSON.stringify({ ...data, threadId: this.#manager.threadId }), channel)
    this.#logger.debug(`Published to ${channel}, ${subCount} subscribers received the message`)
    if (subCount === 0) {
      this.#logger.warn(`Message is not handled by any subscriber on channel ${channel}`)
    }
    return subCount
  }

  setupSub(): Promise<GlideClient> {
    if (this.#sub !== undefined) {
      return this.#sub
    }

    this.#sub = GlideClient.createClient({
      addresses: env.VALKEY_ADDRESSES,
      pubsubSubscriptions: {
        channelsAndPatterns: {
          [GlideClientConfiguration.PubSubChannelModes.Exact]: new Set([
            MCPMessageChannels.SamplingResult,
            MCPMessageChannels.ElicitationResult,
          ]),
        },
        callback: (msg) => {
          const channel = msg.channel.toString()
          const message = msg.message.toString()

          switch (channel) {
            case MCPMessageChannels.SamplingResult:
              this.#handleSamplingResult(message)
              break
            case MCPMessageChannels.ElicitationResult:
              this.#handleElicitationResult(message)
              break
            default:
              this.#logger.warn(`Unknown channel: ${channel}`)
          }
        },
      },
    })

    const TIMEOUT = env.MCP_CACHE_TTL_MS / 2

    this.#manager.setSamplingHandler(async (params) => {
      const subCount = await this.publish(
        { ...params, threadId: this.#manager.threadId },
        MCPMessageChannels.SamplingRequest,
      )

      if (subCount === 0) {
        const msg = 'Sampling request is not handled'
        this.#logger.error(msg)
        throw new Error(msg)
      }

      return new Promise<SamplingResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const msg = 'Sampling request timed out'
          this.#logger.error(msg)
          this.off('samplingResult', listener)
          reject(new Error(msg))
        }, TIMEOUT)

        const listener = (data: SamplingResult) => {
          clearTimeout(timeout)
          resolve(data)
        }
        this.on('samplingResult', listener)
      })
    })

    this.#manager.setElicitationHandler(async (params) => {
      const subCount = await this.publish(
        { ...params, threadId: this.#manager.threadId },
        MCPMessageChannels.ElicitationRequest,
      )
      if (subCount === 0) {
        const msg = 'Elicitation request is not handled'
        this.#logger.error(msg)
        throw new Error(msg)
      }

      return new Promise<ElicitResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const msg = 'Elicitation request timed out'
          this.#logger.error(msg, 'Cancelling')
          this.off('elicitationResult', listener)
          reject(new Error(msg))
        }, TIMEOUT)

        const listener = (data: ElicitResult) => {
          clearTimeout(timeout)
          this.#logger.debug('sending elicitation result', data)
          resolve(data)
        }
        this.on('elicitationResult', listener)
      })
    })

    return this.#sub!
  }

  #handleSamplingResult(msg: string) {
    const de = destr(msg)
    const { success, data, error } = SamplingResultSchema.extend({ threadId: z3.string() }).safeParse(de)
    if (!success) {
      const m = 'Invalid sampling result received'
      this.#logger.error(m, error.message)
      throw new Error(m)
    }
    if (data.threadId === this.#manager.threadId) {
      this.emit('samplingResult', data)
    }
  }

  #handleElicitationResult(msg: string) {
    const de = destr(msg)
    const { success, data, error } = ElicitResultSchema.extend({ threadId: z3.string() }).safeParse(de)
    if (!success) {
      const m = 'Invalid elicitation result received'
      this.#logger.error(m, error.message)
      throw new Error(m)
    }
    if (data.threadId === this.#manager.threadId) {
      this.emit('elicitationResult', data)
    }
  }
}
