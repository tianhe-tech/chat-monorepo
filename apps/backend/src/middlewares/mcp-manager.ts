import { createMiddleware } from 'hono/factory'
import { MCPClient } from '@mastra/mcp'

import { mcpClientStore } from '../mcp/index.ts'
import { builtinMcpServers } from '../config/builtin-mcp-servers.ts'

/**
 * dependent on `authMiddleware`
 */
const mcpManagerMiddleware = createMiddleware(async (c, next) => {
  const id = c.get('userId')

  const client = await mcpClientStore.getOrSet(
    id,
    async () =>
      new MCPClient({
        servers: builtinMcpServers(),
      }),
  )
  c.set('mcpClient', client)

  await next()
})

export default mcpManagerMiddleware

declare module 'hono' {
  interface ContextVariableMap {
    mcpClient?: MCPClient
  }
}
