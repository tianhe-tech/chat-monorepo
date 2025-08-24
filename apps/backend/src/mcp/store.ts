import { Cacheable } from 'cacheable'

export const mcpClientStore = new Cacheable({
  ttl: '30m',
  cacheId: 'mcp-client',
})
