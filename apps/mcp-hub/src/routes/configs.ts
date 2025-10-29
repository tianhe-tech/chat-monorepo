import { zValidator } from '@hono/zod-validator'
import { mcpServerDefinitionSchema } from '@internal/shared/types'
import { ConstraintViolationError, constructDBError } from '@internal/shared/utils'
import { consola } from 'consola'
import { eq, inArray, sql, type InferInsertModel } from 'drizzle-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { err, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'
import { db } from '../infra/db'
import { mcpServerConfig } from '../infra/db/schema'
import { mcpClientCache } from '../infra/mcp-hub-cache'

const logger = consola.withTag('Configs App')

const configsApp = new Hono()
  .post(
    '/',
    zValidator(
      'json',
      z.object({
        servers: z.array(mcpServerDefinitionSchema.extend({ name: z.string() })),
      }),
    ),
    async (c) => {
      const { servers } = c.req.valid('json')
      const user = c.get('user')

      logger.debug('Creating MCP server configs for user:', user)
      logger.debug({ servers })

      const createConfig = ResultAsync.fromPromise(
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
        (err) => {
          const { message, error: dbError } = constructDBError(err)
          logger.error({ error: dbError }, message)
          if (dbError instanceof ConstraintViolationError) {
            return new HTTPException(400, { message: '重复的 MCP Server 配置（名称或 URL）' })
          }
          return new HTTPException(500)
        },
      )

      const result = await createConfig.andTee(() => {
        // Invalidate all threadId-based MCP client cache entries since we don't track which threads belong to this user
        mcpClientCache.clear()
      })

      if (result.isErr()) {
        throw result.error
      }

      return c.json(result.value, 201)
    },
  )
  /**
   * 获取用户的所有 MCP 服务器配置
   */
  .get('/', async (c) => {
    const user = c.get('user')

    const getConfigs = ResultAsync.fromPromise(
      db.query.mcpServerConfig.findMany({
        where: (mcpServerConfig, { and, eq, isNull }) =>
          and(
            eq(mcpServerConfig.userId, user.id),
            eq(mcpServerConfig.scope, user.scope),
            isNull(mcpServerConfig.deletedAt),
          ),
      }),
      (err) => {
        const { message, error: dbError } = constructDBError(err)
        logger.error({ error: dbError }, message)
        return new HTTPException(500)
      },
    )

    const result = await getConfigs

    if (result.isErr()) {
      throw result.error
    }

    return c.json(result.value)
  })
  /**
   * 获取指定 ID 的 MCP 服务器配置
   */
  .get('/:id', zValidator('param', z.object({ id: z.coerce.number() })), async (c) => {
    const { id } = c.req.valid('param')
    const user = c.get('user')

    const getConfig = ResultAsync.fromPromise(
      db.query.mcpServerConfig.findFirst({
        where: (mcpServerConfig, { and, eq, isNull }) =>
          and(
            eq(mcpServerConfig.id, id),
            eq(mcpServerConfig.userId, user.id),
            eq(mcpServerConfig.scope, user.scope),
            isNull(mcpServerConfig.deletedAt),
          ),
      }),
      (err) => {
        const { message, error: dbError } = constructDBError(err)
        logger.error({ error: dbError }, message)
        return new HTTPException(500)
      },
    )

    const result = await getConfig.andThrough((config) => {
      if (config) {
        return ok()
      }
      return err(new HTTPException(404, { message: 'MCP Server 配置不存在' }))
    })

    if (result.isErr()) {
      throw result.error
    }

    return c.json(result.value)
  })
  /**
   * 更新指定 ID 的 MCP 服务器配置
   */
  .put(
    '/:id',
    zValidator('param', z.object({ id: z.coerce.number() })),
    zValidator('json', mcpServerDefinitionSchema.extend({ name: z.string() }).partial()),
    async (c) => {
      const { id } = c.req.valid('param')
      const updates = c.req.valid('json')
      const user = c.get('user')

      // First check if the config exists and belongs to the user
      const findConfig = ResultAsync.fromThrowable(() =>
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

      const existingConfig = findConfig()
        .mapErr((err) => {
          const { message, error: dbError } = constructDBError(err)
          logger.error({ error: dbError }, message)
          return new HTTPException(500)
        })
        .andThrough((config) => {
          if (config) {
            return ok()
          }
          return err(new HTTPException(404, { message: 'MCP Server 配置不存在' }))
        })

      const newConfig = existingConfig.map<Partial<InferInsertModel<typeof mcpServerConfig>>>((config) => ({
        ...config,
        requestInit: {
          ...config?.requestInit,
          headers: updates.headers,
        },
      }))

      const doUpdate = newConfig.andThen((data) =>
        ResultAsync.fromPromise(
          db.update(mcpServerConfig).set(data).where(eq(mcpServerConfig.id, id)).returning(),
          (err) => {
            const { message, error: dbError } = constructDBError(err)
            logger.error({ error: dbError }, message)
            if (dbError instanceof ConstraintViolationError) {
              return new HTTPException(400, { message: '重复的 MCP Server 配置（名称或 URL）' })
            }
            return new HTTPException(500)
          },
        ),
      )

      const result = await doUpdate.andTee(() => {
        // Invalidate all threadId-based MCP client cache entries on config change
        mcpClientCache.clear()
      })

      if (result.isErr()) {
        throw result.error
      }

      return c.json(result.value)
    },
  )
  /**
   * 批量删除 MCP 服务器配置
   */
  .delete('/', zValidator('json', z.object({ ids: z.array(z.number()).min(1) })), async (c) => {
    const { ids } = c.req.valid('json')
    const user = c.get('user')

    // First check which configs exist and belong to the user
    const findExistingIds = ResultAsync.fromPromise(
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
      (err) => {
        const { message, error: dbError } = constructDBError(err)
        logger.error({ error: dbError }, message)
        return new HTTPException(500)
      },
    )
      .andThrough((configs) => {
        if (!configs || configs.length === 0) {
          return err(new HTTPException(404, { message: 'MCP Server 配置不存在' }))
        }
        return ok()
      })
      .map((configs) => configs.map((c) => c.id))

    const doDelete = findExistingIds.andThrough((ids) =>
      ResultAsync.fromPromise(
        db
          .update(mcpServerConfig)
          .set({ deletedAt: sql`NOW()` })
          .where(inArray(mcpServerConfig.id, ids))
          .returning(),
        (err) => {
          const { message, error: dbError } = constructDBError(err)
          logger.error({ error: dbError }, message)
          return new HTTPException(500)
        },
      ),
    )

    const result = await doDelete.andTee(() => {
      // Invalidate all threadId-based MCP client cache entries on deletion
      mcpClientCache.clear()
    })

    if (result.isErr()) {
      throw result.error
    }

    const existingIds = result.value

    return c.json({
      deleted: existingIds.length,
      notFound: ids.filter((id) => !existingIds.includes(id)),
    })
  })

export default configsApp
export type ConfigAppType = typeof configsApp
