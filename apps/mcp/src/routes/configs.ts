import { zValidator } from '@hono/zod-validator'
import { formatDBErrorMessage } from '@repo/shared/db'
import { consola } from 'consola'
import { eq, inArray, sql, type InferInsertModel } from 'drizzle-orm'
import { goTryRaw } from 'go-go-try'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db'
import { mcpServerConfig } from '../db/schema'
import { serverDefinitionSchema } from '../mcp/client'
import { mcpClientCache } from '../mcp/cache'

const logger = consola.withTag('Configs App')

const configsApp = new Hono()
  .post(
    '/',
    zValidator(
      'json',
      z.object({
        servers: z.array(serverDefinitionSchema.extend({ name: z.string() })),
      }),
    ),
    async (c) => {
      const { servers } = c.req.valid('json')
      const user = c.get('user')

      logger.debug('Creating MCP server configs for user:', user)
      logger.debug({ servers })

      const [err, createdConfigs] = await goTryRaw(
        db
          .insert(mcpServerConfig)
          .values(
            servers.map<InferInsertModel<typeof mcpServerConfig>>((server) => ({
              name: server.name,
              url: server.url,
              transport: 'streamable_http',
              userId: user.id,
              scope: user.scope,
              requestInit: {
                headers: server.headers,
              },
            })),
          )
          .returning({
            id: mcpServerConfig.id,
            name: mcpServerConfig.name,
            url: mcpServerConfig.url,
            createdAt: mcpServerConfig.createdAt,
          }),
      )

      if (err) {
        const msg = formatDBErrorMessage(err)
        logger.error(msg)
        if (msg.includes('UNIQUE')) {
          throw new HTTPException(400, { message: '重复的 MCP Server 配置（名称或 URL）' })
        }
        throw new HTTPException(500)
      }

      const key = `${user.id}:${user.scope}`
      mcpClientCache.delete(key)

      return c.json(createdConfigs, 201)
    },
  )
  /**
   * 获取用户的所有 MCP 服务器配置
   */
  .get('/', async (c) => {
    const user = c.get('user')

    const [err, configs] = await goTryRaw(
      db.query.mcpServerConfig.findMany({
        where: (mcpServerConfig, { and, eq, isNull }) =>
          and(
            eq(mcpServerConfig.userId, user.id),
            eq(mcpServerConfig.scope, user.scope),
            isNull(mcpServerConfig.deletedAt),
          ),
      }),
    )

    if (err) {
      const msg = formatDBErrorMessage(err)
      logger.error(msg)
      throw new HTTPException(500)
    }

    return c.json(configs)
  })
  /**
   * 获取指定 ID 的 MCP 服务器配置
   */
  .get('/:id', zValidator('param', z.object({ id: z.coerce.number() })), async (c) => {
    const { id } = c.req.valid('param')
    const user = c.get('user')

    const [err, config] = await goTryRaw(
      db.query.mcpServerConfig.findFirst({
        where: (mcpServerConfig, { and, eq, isNull }) =>
          and(
            eq(mcpServerConfig.id, id),
            eq(mcpServerConfig.userId, user.id),
            eq(mcpServerConfig.scope, user.scope),
            isNull(mcpServerConfig.deletedAt),
          ),
      }),
    )

    if (err) {
      const msg = formatDBErrorMessage(err)
      logger.error(msg)
      throw new HTTPException(500)
    }

    if (!config) {
      throw new HTTPException(404, { message: 'MCP Server 配置不存在' })
    }

    return c.json(config)
  })
  /**
   * 更新指定 ID 的 MCP 服务器配置
   */
  .put(
    '/:id',
    zValidator('param', z.object({ id: z.coerce.number() })),
    zValidator('json', serverDefinitionSchema.extend({ name: z.string() }).partial()),
    async (c) => {
      const { id } = c.req.valid('param')
      const updates = c.req.valid('json')
      const user = c.get('user')

      // First check if the config exists and belongs to the user
      const [findErr, existingConfig] = await goTryRaw(
        db.query.mcpServerConfig.findFirst({
          where: (mcpServerConfig, { and, eq, isNull }) =>
            and(
              eq(mcpServerConfig.id, id),
              eq(mcpServerConfig.userId, user.id),
              eq(mcpServerConfig.scope, user.scope),
              isNull(mcpServerConfig.deletedAt),
            ),
        }),
      )

      if (findErr) {
        const msg = formatDBErrorMessage(findErr)
        logger.error(msg)
        throw new HTTPException(500)
      }

      if (!existingConfig) {
        throw new HTTPException(404, { message: 'MCP Server 配置不存在' })
      }

      // Prepare update data
      const updateData: Partial<InferInsertModel<typeof mcpServerConfig>> = {}
      if (updates.name) updateData.name = updates.name
      if (updates.url) updateData.url = updates.url
      if (updates.headers) {
        updateData.requestInit = {
          ...existingConfig.requestInit,
          headers: updates.headers,
        }
      }

      const [updateErr, updatedConfig] = await goTryRaw(
        db.update(mcpServerConfig).set(updateData).where(eq(mcpServerConfig.id, id)).returning(),
      )

      if (updateErr) {
        const msg = formatDBErrorMessage(updateErr)
        logger.error(msg)
        if (msg.includes('UNIQUE')) {
          throw new HTTPException(400, { message: '重复的 MCP Server 配置（名称或 URL）' })
        }
        throw new HTTPException(500)
      }

      // Invalidate MCP client cache
      const key = `${user.id}:${user.scope}`
      mcpClientCache.delete(key)

      return c.json(updatedConfig[0])
    },
  )
  /**
   * 批量删除 MCP 服务器配置
   */
  .delete('/', zValidator('json', z.object({ ids: z.array(z.number()).min(1) })), async (c) => {
    const { ids } = c.req.valid('json')
    const user = c.get('user')

    // First check which configs exist and belong to the user
    const [findErr, existingConfigs] = await goTryRaw(
      db.query.mcpServerConfig.findMany({
        where: (mcpServerConfig, { and, eq, isNull, inArray }) =>
          and(
            inArray(mcpServerConfig.id, ids),
            eq(mcpServerConfig.userId, user.id),
            eq(mcpServerConfig.scope, user.scope),
            isNull(mcpServerConfig.deletedAt),
          ),
        columns: { id: true },
      }),
    )

    if (findErr) {
      const msg = formatDBErrorMessage(findErr)
      logger.error(msg)
      throw new HTTPException(500)
    }

    if (!existingConfigs || existingConfigs.length === 0) {
      throw new HTTPException(404, { message: 'MCP Server 配置不存在' })
    }

    const existingIds = existingConfigs.map((config) => config.id)

    const [deleteErr] = await goTryRaw(
      db
        .update(mcpServerConfig)
        .set({ deletedAt: sql`NOW()` })
        .where(inArray(mcpServerConfig.id, existingIds))
        .returning(),
    )

    if (deleteErr) {
      const msg = formatDBErrorMessage(deleteErr)
      logger.error(msg)
      throw new HTTPException(500)
    }

    // Invalidate MCP client cache
    const key = `${user.id}:${user.scope}`
    mcpClientCache.delete(key)

    return c.json({
      deleted: existingIds.length,
      notFound: ids.filter((id) => !existingIds.includes(id)),
    })
  })

export default configsApp
export type ConfigAppType = typeof configsApp
