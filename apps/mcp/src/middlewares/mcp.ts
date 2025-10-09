import { createMiddleware } from 'hono/factory'
import { MCPClientManager } from '../mcp/client'
import { formatDBErrorMessage } from '@repo/shared/utils'
import { mcpClientCache } from '../mcp/cache'
import { consola } from 'consola'
import { db } from '../db'
import { goTryRaw } from 'go-go-try'
import { HTTPException } from 'hono/http-exception'
import assert from 'node:assert'
import { env } from '../env'
import type { MCPServerDefinition } from '@repo/shared/types'
import { MCPClientPubSubCoordinator } from '../mcp/client-pubsub'

const logger = consola.withTag('MCP Middleware')

/**
 * @pre Auth Middleware
 * @pre `header['mcp-thread-id']` validated
 */
const mcpMiddleware = createMiddleware(async (c, next) => {
  const threadId = c.req.header('mcp-thread-id')
  assert.ok(threadId)

  const user = c.get('user')

  const existingClient = mcpClientCache.get(threadId)
  if (existingClient) {
    logger.debug(`Cache hit (${threadId})`)
    c.set('mcpClient', existingClient)
    await next()
    return
  }
  logger.debug(`Cache miss (${threadId})`)

  const [err, serverConfigs] = await goTryRaw(
    db.query.mcpServerConfig.findMany({
      where: (config, { and, eq, isNull }) =>
        and(eq(config.userId, user.id), eq(config.scope, user.scope), isNull(config.deletedAt)),
    }),
  )

  if (err) {
    const msg = formatDBErrorMessage(err)
    logger.error(msg)
    throw new HTTPException(500)
  }

  if (serverConfigs.length === 0) {
    logger.warn(`No MCP Server config found for user(${user.id}) with scope(${user.scope})`)
    return next()
  }

  const servers = Object.fromEntries(
    serverConfigs.map<[string, MCPServerDefinition]>((config) => [
      config.name,
      { url: config.url, headers: config.requestInit?.headers },
    ]),
  )
  const newClient = new MCPClientManager({
    servers,
  })

  const pubsub = await MCPClientPubSubCoordinator.new({
    id: threadId,
    clientManager: newClient,
    valkeyAddresses: env.VALKEY_ADDRESSES,
  })

  if (pubsub.isErr()) {
    throw new HTTPException(500)
  }
  mcpClientCache.set(threadId, newClient)
  // TODO: handle newClient connection error
  c.set('mcpClient', newClient)

  await next()

  c.get(threadId) // refresh ttl
})

export default mcpMiddleware

declare module 'hono' {
  interface ContextVariableMap {
    mcpClient?: MCPClientManager
  }
}
