import { createMCPHubTTLCache } from '../../infra/mcp-hub-cache'
import { env } from '../env'

let mcphubCache: ReturnType<typeof createMCPHubTTLCache> | undefined = undefined

export function getMCPHubCache() {
  if (mcphubCache === undefined) {
    mcphubCache = createMCPHubTTLCache(env.MCP_CACHE_TTL_MS)
  }
  return mcphubCache
}

type UserInfo = {
  userId: string
  scope: string
}

const mcphubCacheKeyRegistry = new Map<string, Set<string>>()

const buildRegistryKey = ({ userId, scope }: UserInfo) => `${userId}:${scope}`

export class MCPHubCacheKeyRegistry {
  #registryKey: string

  constructor(params: UserInfo) {
    this.#registryKey = buildRegistryKey(params)
  }

  register(cacheKey: string) {
    let set = mcphubCacheKeyRegistry.get(this.#registryKey)
    if (!set) {
      set = new Set<string>()
      mcphubCacheKeyRegistry.set(this.#registryKey, set)
    }
    set.add(cacheKey)
  }

  invalidate() {
    const set = mcphubCacheKeyRegistry.get(this.#registryKey)
    if (!set || !mcphubCache) {
      return
    }
    for (const cacheKey of set) {
      mcphubCache.delete(cacheKey)
    }
  }
}
