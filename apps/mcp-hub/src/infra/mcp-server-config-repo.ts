// oxlint-disable default-case
import { and, eq, isNull, sql } from 'drizzle-orm'
import { Result, ResultAsync, errAsync, ok, okAsync } from 'neverthrow'
import type { db } from './db'
import { mcpServerConfig } from './db/schema'
import { MCPServerConfigDuplicateError, type UserMCPServerConfigRepo } from '../domain/port/repository'
import { mcpServerConfigSchema, type MCPServerConfig } from '@th-chat/shared/contracts/mcp-server-config'
type MCPServerConfigRow = typeof mcpServerConfig.$inferSelect

type CtorParams = {
  userId: string
  scope: string
  db: typeof db
}

const coerceError = (operation: string, error: unknown) => {
  if (error instanceof Error) {
    return error
  }
  return new Error(`Failed to ${operation}: ${String(error)}`)
}

const extractPgError = (error: unknown): { code?: string; detail?: string } | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  if ('code' in error || 'detail' in error) {
    return error as { code?: string; detail?: string }
  }

  if ('cause' in error) {
    return extractPgError((error as { cause?: unknown }).cause)
  }

  return undefined
}

const mapDbError = (operation: string, error: unknown) => {
  const pgError = extractPgError(error)
  if (pgError?.code === '23505') {
    return new MCPServerConfigDuplicateError(pgError.detail ?? 'Duplicate MCP server config detected')
  }
  return coerceError(operation, error)
}

const toDomainConfig = (row: MCPServerConfigRow) =>
  Result.fromThrowable(
    () => {
      const payload = (() => {
        switch (row.transport) {
          case 'stdio': {
            if (!row.command || row.command.length === 0) {
              throw new Error(`Stdio transport requires a command`)
            }
            return {
              name: row.name,
              transport: row.transport,
              command: row.command,
            } as const
          }
          case 'sse':
          case 'streamable_http': {
            if (!row.url) {
              throw new Error(`${row.transport} transport requires a URL`)
            }
            return {
              name: row.name,
              transport: row.transport,
              url: row.url,
              requestInit: row.requestInit ?? undefined,
            } as const
          }
        }
      })()

      return {
        id: row.id,
        ...mcpServerConfigSchema.parse(payload),
      }
    },
    (error) => coerceError('map server config row', error),
  )()

export class UserMCPServerConfigRepoImpl implements UserMCPServerConfigRepo {
  readonly #db: typeof db
  readonly userId: string
  readonly scope: string

  constructor({ userId, scope, db }: CtorParams) {
    this.userId = userId
    this.scope = scope
    this.#db = db
  }

  upsert(config: MCPServerConfig & { id?: number }) {
    const { id, ...rest } = config
    const serverConfig = rest as MCPServerConfig

    if (id === undefined) {
      const rowResult = this.#toInsertRow(serverConfig)
      if (rowResult.isErr()) {
        return errAsync(rowResult.error)
      }

      return ResultAsync.fromPromise(
        this.#db.insert(mcpServerConfig).values(rowResult.value).returning({ id: mcpServerConfig.id }),
        (error) => mapDbError('create MCP server config', error),
      ).andThen((rows) => {
        const first = rows.at(0)
        if (!first) {
          return errAsync(new Error('Insert succeeded but no identifier was returned'))
        }
        return okAsync(first.id)
      })
    }

    let payload: Partial<MCPServerConfigRow>
    try {
      payload = this.#toUpdatePayload(serverConfig)
    } catch (error) {
      return errAsync(coerceError('prepare update payload', error))
    }

    return ResultAsync.fromPromise(
      this.#db
        .update(mcpServerConfig)
        .set({
          ...payload,
          updatedAt: sql`NOW()`,
        })
        .where(this.#byIdScope(id))
        .returning({ id: mcpServerConfig.id }),
      (error) => mapDbError('update MCP server config', error),
    ).andThen((rows) => {
      const first = rows.at(0)
      if (!first) {
        return errAsync(new Error(`Update failed for MCP Server Config ID ${id}`))
      }
      return okAsync(first.id)
    })
  }

  getMany() {
    return ResultAsync.fromPromise(
      this.#db.query.mcpServerConfig.findMany({
        where: (table, { and, eq, isNull }) =>
          and(eq(table.userId, this.userId), eq(table.scope, this.scope), isNull(table.deletedAt)),
        orderBy: (table, { desc }) => desc(table.id),
      }),
      (error) => coerceError('list MCP server configs', error),
    ).andThen((rows) => this.#mapRows(rows))
  }

  getById(id: number) {
    return ResultAsync.fromPromise(
      this.#db.query.mcpServerConfig.findFirst({
        where: (table, { and, eq, isNull }) =>
          and(eq(table.id, id), eq(table.userId, this.userId), eq(table.scope, this.scope), isNull(table.deletedAt)),
      }),
      (error) => coerceError('find MCP server config by id', error),
    ).andThen((row) => {
      if (!row) {
        return okAsync(undefined)
      }

      const result = toDomainConfig(row)
      if (result.isErr()) {
        return errAsync(result.error)
      }

      return okAsync(result.value)
    })
  }

  delete(id: number) {
    return ResultAsync.fromPromise(
      this.#db
        .update(mcpServerConfig)
        .set({ deletedAt: sql`NOW()` })
        .where(this.#byIdScope(id)),
      (error) => coerceError('delete MCP server config', error),
    ).map(() => undefined)
  }

  #mapRows(rows: MCPServerConfigRow[]) {
    const mapped = rows.map(toDomainConfig)
    const combined = Result.combine(mapped)

    if (combined.isErr()) {
      return errAsync(combined.error)
    }

    return okAsync(combined.value)
  }

  #toInsertRow(config: MCPServerConfig) {
    switch (config.transport) {
      case 'stdio':
        return ok({
          userId: this.userId,
          scope: this.scope,
          name: config.name,
          transport: config.transport,
          command: config.command,
          url: null,
          requestInit: null,
        })
      case 'sse':
      case 'streamable_http':
        return ok({
          userId: this.userId,
          scope: this.scope,
          name: config.name,
          transport: config.transport,
          url: config.url,
          command: null,
          requestInit: config.requestInit ?? null,
        })
    }
  }

  #toUpdatePayload(config: MCPServerConfig) {
    switch (config.transport) {
      case 'stdio':
        return {
          name: config.name,
          transport: config.transport,
          command: config.command,
          url: null,
          requestInit: null,
        }
      case 'sse':
      case 'streamable_http':
        return {
          name: config.name,
          transport: config.transport,
          command: null,
          url: config.url,
          requestInit: config.requestInit ?? null,
        }
    }
  }

  #byIdScope(id: number) {
    return and(
      eq(mcpServerConfig.id, id),
      eq(mcpServerConfig.userId, this.userId),
      eq(mcpServerConfig.scope, this.scope),
      isNull(mcpServerConfig.deletedAt),
    )
  }
}
