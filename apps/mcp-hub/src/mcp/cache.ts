import TTLCache from '@isaacs/ttlcache'
import { env } from '../env'
import type { MCPClientManager } from './client'

export const mcpClientCache = new TTLCache<string, MCPClientManager>({
  ttl: env.MCP_CACHE_TTL_MS,
  updateAgeOnGet: true,
  dispose: (client, key) => {
    console.debug(`Invalidating mcp client cache (${key})`)
    client?.close()
  },
})
