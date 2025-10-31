import { zValidator } from '@hono/zod-validator'
import * as Contract from '@th-chat/shared/contracts/mcp-server-config'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import z from 'zod'
import { createMCPServerConfigUseCase, DuplicateConfigError, NotFoundError } from '../use-case/mcp-server-config'
import { MCPHubCacheKeyRegistry } from '../service/mcp-hub-cache'

export default new Hono()
  .post('/', zValidator('json', Contract.mcpServerConfigSchema), async (c) => {
    const serverConfig = c.req.valid('json')
    const user = c.get('user')

    const usecase = createMCPServerConfigUseCase({ userId: user.id, scope: user.scope })

    const result = await usecase.create({ serverConfig })
    if (result.isOk()) {
      return c.json(result.value, 201)
    }

    if (result.error instanceof DuplicateConfigError) {
      throw new HTTPException(400, { message: '重复的 MCP Server 配置（名称或 URL）', cause: result.error })
    }
    throw new HTTPException(500, { cause: result.error })
  })
  .get('/', async (c) => {
    const user = c.get('user')

    const usecase = createMCPServerConfigUseCase({ userId: user.id, scope: user.scope })

    const result = await usecase.getMany()
    if (result.isOk()) {
      return c.json(result.value)
    }
    throw new HTTPException(500, { cause: result.error })
  })
  .get('/:id', zValidator('param', z.object({ id: z.coerce.number() })), async (c) => {
    const { id } = c.req.valid('param')
    const user = c.get('user')

    const usecase = createMCPServerConfigUseCase({ userId: user.id, scope: user.scope })

    const result = await usecase.getById({ id })
    if (result.isErr()) {
      throw new HTTPException(500, { cause: result.error })
    }
    if (!result.value) {
      throw new HTTPException(404)
    }
    return c.json(result.value)
  })
  .put(
    '/:id',
    zValidator('param', z.object({ id: z.coerce.number() })),
    zValidator('json', Contract.mcpServerConfigSchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const user = c.get('user')
      const serverConfig = c.req.valid('json')

      const usecase = createMCPServerConfigUseCase({ userId: user.id, scope: user.scope })
      const registry = new MCPHubCacheKeyRegistry({ userId: user.id, scope: user.scope })

      const result = await usecase.update({ id, serverConfig })
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
  .delete('/:id', zValidator('param', z.object({ id: z.coerce.number() })), async (c) => {
    const { id } = c.req.valid('param')
    const user = c.get('user')

    const usecase = createMCPServerConfigUseCase({ userId: user.id, scope: user.scope })
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
  })
