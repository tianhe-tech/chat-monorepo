import * as Contract from '@th-chat/shared/contracts/mcp-server-config'
import { HTTPException } from 'hono/http-exception'
import { createMCPServerConfigUseCase, DuplicateConfigError, NotFoundError } from '../use-case/mcp-server-config'
import { MCPHubCacheKeyRegistry } from '../service/mcp-hub-cache'
import { UserMCPServerConfigRepoImpl } from '../../infra/mcp-server-config-repo'
import { db } from '../../infra/db'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const mcpServerConfigWithIdSchema = Contract.mcpServerConfigSchema.and(
  z.object({
    id: z.number(),
  }),
)

const configIdParamSchema = z.object({
  // Using z.coerce.number() directly causes issues with scalar UI fields.
  // Solution from https://github.com/honojs/middleware/issues/368#issuecomment-1974821532
  id: z.string().pipe(z.coerce.number()),
})

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: 'post',
      path: '/',
      description: '创建 MCP Server 配置',
      request: {
        body: {
          content: {
            'application/json': {
              schema: Contract.mcpServerConfigSchema,
            },
          },
        },
      },
      responses: {
        201: {
          content: {
            'application/json': {
              schema: z.object({ id: z.number() }),
            },
          },
          description: '创建成功',
        },
        400: {
          description: '重复的 MCP Server 配置',
        },
      },
    }),
    async (c) => {
      const serverConfig = c.req.valid('json')
      const user = c.get('user')

      const repo = new UserMCPServerConfigRepoImpl({ userId: user.id, scope: user.scope, db })
      const usecase = createMCPServerConfigUseCase({ repo })
      const registry = new MCPHubCacheKeyRegistry({ userId: user.id, scope: user.scope })

      const result = await usecase.upsert({ serverConfig })
      if (result.isOk()) {
        registry.invalidate()
        return c.json({ id: result.value }, 201)
      }

      if (result.error instanceof DuplicateConfigError) {
        throw new HTTPException(400, { message: '重复的 MCP Server 配置', cause: result.error })
      }
      throw new HTTPException(500, { cause: result.error })
    },
  )
  .openapi(
    createRoute({
      method: 'get',
      path: '/',
      description: 'List user MCP Server configurations',
      responses: {
        200: {
          description: '配置列表',
          content: {
            'application/json': {
              schema: z.array(mcpServerConfigWithIdSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const user = c.get('user')

      const repo = new UserMCPServerConfigRepoImpl({ userId: user.id, scope: user.scope, db })
      const usecase = createMCPServerConfigUseCase({ repo })

      const result = await usecase.getMany()
      if (result.isOk()) {
        return c.json(result.value)
      }
      throw new HTTPException(500, { cause: result.error })
    },
  )
  .openapi(
    createRoute({
      method: 'get',
      path: '/{id}',
      description: 'Get MCP Server configuration by ID',
      request: {
        params: configIdParamSchema,
      },
      responses: {
        200: {
          description: '配置详情',
          content: {
            'application/json': {
              schema: mcpServerConfigWithIdSchema,
            },
          },
        },
        404: {
          description: '配置不存在',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param')
      const user = c.get('user')

      const repo = new UserMCPServerConfigRepoImpl({ userId: user.id, scope: user.scope, db })
      const usecase = createMCPServerConfigUseCase({ repo })

      const result = await usecase.getById({ id })
      if (result.isErr()) {
        throw new HTTPException(500, { cause: result.error })
      }
      if (!result.value) {
        throw new HTTPException(404)
      }
      return c.json(result.value)
    },
  )
  .openapi(
    createRoute({
      method: 'put',
      path: '/{id}',
      description: 'Update MCP Server configuration',
      request: {
        params: configIdParamSchema,
        body: {
          content: {
            'application/json': {
              schema: Contract.mcpServerConfigSchema,
            },
          },
        },
      },
      responses: {
        204: {
          description: 'Updated successfully',
        },
        400: {
          description: '重复的 MCP Server 配置（名称或 URL）',
        },
        404: {
          description: '配置不存在',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param')
      const user = c.get('user')
      const serverConfig = c.req.valid('json')

      const repo = new UserMCPServerConfigRepoImpl({ userId: user.id, scope: user.scope, db })
      const usecase = createMCPServerConfigUseCase({ repo })
      const registry = new MCPHubCacheKeyRegistry({ userId: user.id, scope: user.scope })

      const result = await usecase.upsert({ serverConfig: { ...serverConfig, id } })
      if (result.isOk()) {
        registry.invalidate()
        c.status(204)
        return c.body(null)
      }
      if (result.error instanceof NotFoundError) {
        throw new HTTPException(404, { cause: result.error })
      }
      if (result.error instanceof DuplicateConfigError) {
        throw new HTTPException(400, { message: '重复的 MCP Server 配置（名称或 URL）', cause: result.error })
      }
      throw new HTTPException(500, { cause: result.error })
    },
  )
  .openapi(
    createRoute({
      method: 'delete',
      path: '/{id}',
      description: 'Delete MCP Server configuration',
      request: {
        params: configIdParamSchema,
      },
      responses: {
        204: {
          description: 'Deleted successfully',
        },
        404: {
          description: 'Configuration not found',
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param')
      const user = c.get('user')

      const repo = new UserMCPServerConfigRepoImpl({ userId: user.id, scope: user.scope, db })
      const usecase = createMCPServerConfigUseCase({ repo })
      const registry = new MCPHubCacheKeyRegistry({ userId: user.id, scope: user.scope })

      const result = await usecase.delete({ id })
      if (result.isOk()) {
        registry.invalidate()
        c.status(204)
        return c.body(null)
      }
      if (result.error instanceof NotFoundError) {
        throw new HTTPException(404, { cause: result.error })
      }
      throw new HTTPException(500, { cause: result.error })
    },
  )
