import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import * as Contract from '@th-chat/shared/contracts/chat-mcp-hub'
import { CallToolResultSchema, ToolSchema } from '@th-chat/shared/contracts/mcp-schemas'
import { HTTPException } from 'hono/http-exception'
import { db } from '../../infra/db/index.ts'
import { UserMCPServerConfigRepoImpl } from '../../infra/mcp-server-config-repo.ts'
import { MCPHubCacheKeyRegistry } from '../service/mcp-hub-cache.ts'
import { createMCPHubUseCase, NotFoundError } from '../use-case/mcp-hub.ts'

const headerSchema = z.object({
  'mcp-thread-id': z.string(),
})

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: 'get',
      path: '/',
      request: {
        headers: headerSchema,
      },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: z.array(ToolSchema),
            },
          },
          description: 'All MCP tools',
        },
        404: {
          description: 'No MCP tools found',
        },
      },
    }),
    async (c) => {
      const user = c.get('user')
      const { 'mcp-thread-id': threadId } = c.req.valid('header')

      const repo = new UserMCPServerConfigRepoImpl({ userId: user.id, scope: user.scope, db })
      const mcpHubCacheKeyRegistry = new MCPHubCacheKeyRegistry({ userId: user.id, scope: user.scope })
      const result = await createMCPHubUseCase({ repo, mcpHubCacheKeyRegistry, threadId }).andThen((usecase) =>
        usecase.listTools(),
      )

      if (result.isOk()) {
        return c.json(result.value)
      }
      if (result.error instanceof NotFoundError) {
        throw new HTTPException(404, { cause: result.error })
      }
      throw new HTTPException(500, { cause: result.error })
    },
  )
  .openapi(
    createRoute({
      method: 'post',
      path: '/',
      request: {
        headers: headerSchema,
        body: {
          content: {
            'application/json': {
              schema: Contract.toolCallRequestSchema.shape.data,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: CallToolResultSchema,
            },
          },
          description: 'Tool call result',
        },
      },
    }),
    async (c) => {
      const user = c.get('user')
      const { 'mcp-thread-id': threadId } = c.req.valid('header')
      const data = await c.req.json()

      const repo = new UserMCPServerConfigRepoImpl({ userId: user.id, scope: user.scope, db })
      const mcpHubCacheKeyRegistry = new MCPHubCacheKeyRegistry({ userId: user.id, scope: user.scope })
      const result = await createMCPHubUseCase({ repo, mcpHubCacheKeyRegistry, threadId }).andThen((usecase) =>
        usecase.callTool(data),
      )

      if (result.isOk()) {
        return c.json(result.value)
      }
      throw new HTTPException(500, { cause: result.error })
    },
  )
