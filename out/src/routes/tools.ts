import { Hono } from 'hono'
import mcpMiddleware from '../middlewares/mcp'
import { HTTPException } from 'hono/http-exception'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const toolsApp = new Hono()
  .use(mcpMiddleware)
  .get(
    '/',
    zValidator(
      'query',
      z.object({
        refresh: z.stringbool().optional().default(false),
      }),
    ),
    async (c) => {
      const mcpClient = c.get('mcpClient')
      if (!mcpClient) {
        throw new HTTPException(404)
      }
      const query = c.req.valid('query')
      const tools = query.refresh ? await mcpClient.fetchTools() : await mcpClient.listTools()
      return c.json(tools)
    },
  )
  .post(
    '/',
    zValidator(
      'json',
      z.looseObject({
        name: z.string(),
        arguments: z.optional(z.record(z.string(), z.unknown())),
        _meta: z.optional(
          z.looseObject({
            progressToken: z.optional(z.union([z.string(), z.number()])),
          }),
        ),
      }),
    ),
    async (c) => {
      const mcpClient = c.get('mcpClient')
      if (!mcpClient) {
        throw new HTTPException(404)
      }
      const params = c.req.valid('json')
      const result = await mcpClient.callTool(params, { signal: c.req.raw.signal })
      return c.json(result)
    },
  )

export default toolsApp
