import { CacheableMemory } from 'cacheable'

const mcpClientStore = new CacheableMemory({
  ttl: '30m',
  useClone: false,
})

export default mcpClientStore
