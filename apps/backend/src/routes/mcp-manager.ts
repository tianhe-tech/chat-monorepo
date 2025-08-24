import { Hono } from 'hono'

import { e } from '../utils/http.ts'
import authMiddleware from '../middlewares/auth.ts'
import mcpManagerMiddleware from '../middlewares/mcp-manager.ts'

const mcpManagerApp = new Hono()
  .use(authMiddleware)
  .use(mcpManagerMiddleware)
  /**
   * 启动用户的 MCP Clients
   */
  .put('/', async (c) => {
    return c.json(null, 201)
  })
  /**
   * WIP: 获取用户的 MCP Clients 元数据
   */
  .get('/', async (c) => {
    const mcpClient = c.get('mcpClient')
    if (!mcpClient) {
      return c.json(e('MCP client is not available'), 404)
    }

    const tools = await mcpClient.getToolsets()

    for (const server of Object.values(tools)) {
      for (const tool of Object.values(server)) {
        delete tool.inputSchema
        delete tool.outputSchema
      }
    }

    return c.json({
      tools,
    })
  })

export default mcpManagerApp
