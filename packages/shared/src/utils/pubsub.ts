import { GlideClient, GlideClientConfiguration } from '@valkey/valkey-glide'
import { consola, type ConsolaInstance } from 'consola'

export type SubCallback<Channels extends string> = (params: { channel: Channels; message: string }) => void
export type ValkeyAddresses = { host: string; port: number }[]

export type PubSubOptions<Channels extends string> = {
  valkeyAddresses: ValkeyAddresses
  channels: Channels[]
  subCallback: SubCallback<Channels>
  logTag?: string
}

export class PubSub<Channels extends string> {
  #logger: ConsolaInstance
  #pub?: GlideClient
  #sub?: GlideClient

  protected constructor({ logTag = 'PubSub' }: Pick<PubSubOptions<Channels>, 'logTag'>) {
    this.#logger = consola.withTag(logTag)
  }

  static async createPubSub<Channels extends string = string>({
    valkeyAddresses,
    subCallback,
    channels,
    logTag,
  }: PubSubOptions<Channels>) {
    const instance = new PubSub<Channels>({ logTag })
    instance.#pub = await GlideClient.createClient({
      addresses: valkeyAddresses,
      lazyConnect: true,
    })
    instance.#sub = await GlideClient.createClient({
      addresses: valkeyAddresses,
      pubsubSubscriptions: {
        channelsAndPatterns: {
          [GlideClientConfiguration.PubSubChannelModes.Exact]: new Set(channels),
        },
        callback: (msg) => {
          const channel = msg.channel.toString() as Channels
          const message = msg.message.toString()
          subCallback({ channel, message })
        },
      },
    })
    return instance
  }

  close() {
    return this[Symbol.dispose]()
  }

  [Symbol.dispose]() {
    this.#logger.log('Closing...')
    this.#pub?.close()
    this.#sub?.close()
    this.#logger.log('Closed')
  }

  async publish({ channel, message }: { channel: Channels; message: string }) {
    if (!this.#pub) {
      // technically, this won't happen, we do this only as a type guard
      throw new Error('PubSub not initialized')
    }
    this.#logger.debug(`Publishing to ${channel}:`, message)
    const subCount = await this.#pub.publish(message, channel)
    this.#logger.debug(`Published to ${channel}, ${subCount} subscribers received the message`)
    if (subCount === 0) {
      this.#logger.warn(`Message is not handled by any subscriber on channel ${channel}`)
    }
    return subCount
  }
}
