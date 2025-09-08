import type { MCPClient } from '@mastra/mcp'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { mcpClientStore } from '../mcp/index.ts'

/**
 * dependent on `authMiddleware`
 */
const mcpClientMiddleware = createMiddleware(async (c, next) => {
  const userId = c.get('userId')
  if (!userId) {
    console.error(new Error('mcpClientMiddleware is dependent on authMiddleware'))
    throw new HTTPException(500)
  }
  const mcpClientId = c.req.header('mcp-client-id')
  if (!mcpClientId) {
    throw new HTTPException(400, { message: 'Mcp-Client-Id header is missing' })
  }

  const key = `${userId}:${mcpClientId}`

  const client = mcpClientStore.get<MCPClient>(key)
  if (!client) {
    throw new HTTPException(404, { message: 'MCP client is not available' })
  }
  mcpClientStore.set(key, client) // extend ttl
  c.set('mcpClient', client)

  await next()
})

export default mcpClientMiddleware

declare module 'hono' {
  interface ContextVariableMap {
    mcpClient: MCPClient
  }
}
