import { zValidator } from '@hono/zod-validator'
import { MCPClient, type MastraMCPServerDefinition } from '@mastra/mcp'
import { Hono } from 'hono'
import { z } from 'zod'
import authMiddleware from '../middlewares/auth.ts'
import mcpClientMiddleware from '../middlewares/mcp-client.ts'
import mcpClientStore from '../mcp/store.ts'

const mcpServerSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
})
const mcpServerRecordSchema = z.record(z.string(), mcpServerSchema)
const mcpServerArraySchema = z.array(mcpServerSchema.extend({ name: z.string() }))

const mcpClientApp = new Hono()
  .use(authMiddleware)
  /**
   * 启动 MCP Client 并绑定 id
   */
  .put(
    '/',
    zValidator(
      'header',
      z.object({
        'Mcp-Client-Id': z.string().uuid(),
      }),
    ),
    zValidator(
      'json',
      z
        .object({
          servers: z.union([mcpServerArraySchema, mcpServerRecordSchema]),
        })
        .transform(({ servers, ...rest }) => {
          const result: Record<string, MastraMCPServerDefinition> = {}
          if (!Array.isArray(servers)) {
            for (const name in servers) {
              result[name] = {
                url: new URL(servers[name].url),
                requestInit: {
                  headers: servers[name].headers,
                },
              }
            }
          } else {
            for (const server of servers) {
              result[server.name] = {
                url: new URL(server.url),
                requestInit: {
                  headers: server.headers,
                },
              }
            }
          }
          return {
            servers: result,
            ...rest,
          }
        }),
    ),
    async (c) => {
      const userId = c.get('userId')
      const mcpClientId = c.req.valid('header')['Mcp-Client-Id']
      const { servers } = c.req.valid('json')

      const key = `${userId}:${mcpClientId}`

      const existingClient = mcpClientStore.get<MCPClient>(key)
      if (existingClient) {
        await existingClient.disconnect()
      }

      const client = new MCPClient({ servers, id: key })
      mcpClientStore.set(key, client)

      return c.body(null, 204)
    },
  )
  /**
   * WIP: 获取用户的 MCP Clients 元数据
   */
  .get('/', mcpClientMiddleware, async (c) => {
    const mcpClient = c.get('mcpClient')

    const tools = await mcpClient.getToolsets()
    console.debug(await tools.slurm['get_slurm_partitions_info'].execute({}))

    return c.json({
      tools,
      resources: await mcpClient.resources.list(),
      prompts: await mcpClient.prompts.list(),
    })
  })

export default mcpClientApp
