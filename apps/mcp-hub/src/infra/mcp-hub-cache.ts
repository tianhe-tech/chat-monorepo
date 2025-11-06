import TTLCache from '@isaacs/ttlcache'
import type { MCPHubService } from '../domain/service/mcp-hub'

export function createMCPHubTTLCache(ttlMs: number) {
  return new TTLCache<string, MCPHubService>({
    ttl: ttlMs,
    updateAgeOnGet: true,
    dispose: async (service, key) => {
      if (service) {
        console.debug(`Invalidating mcp hub service cache (${key})`)
        await service[Symbol.asyncDispose]()
      }
    },
  })
}
