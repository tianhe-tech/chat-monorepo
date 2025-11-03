import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { Result, ResultAsync, err, errAsync, ok, okAsync } from 'neverthrow'
import { db } from './db'
import { mcpServerConfig } from './db/schema'
import type { UserMCPServerConfigRepo } from '../domain/port/repository'
import { mcpServerConfigSchema, type MCPServerConfig } from '@th-chat/shared/contracts/mcp-server-config'
type MCPServerConfigRow = typeof mcpServerConfig.$inferSelect

type DrizzleMCPServerConfigRepoOptions = {
  userId: string
  scope: string
}

const unsupportedTransportError = (transport: string) =>
  new Error(`Transport "${transport}" is not supported by the persistent MCP repository`)

const coerceError = (operation: string, error: unknown) => {
  if (error instanceof Error) {
    return error
  }
  return new Error(`Failed to ${operation}: ${String(error)}`)
}

const toDomainConfig = (row: MCPServerConfigRow) =>
  Result.fromThrowable(
    () => ({
      id: row.id,
      ...mcpServerConfigSchema.parse({
        name: row.name,
        transport: row.transport,
        url: row.url,
        requestInit: row.requestInit ?? undefined,
      }),
    }),
    (error) => coerceError('map server config row', error),
  )()

export class UserMCPServerConfigRepoImpl implements UserMCPServerConfigRepo {
  readonly #db = db
  readonly userId: string
  readonly scope: string

  constructor({ userId, scope }: DrizzleMCPServerConfigRepoOptions) {
    this.userId = userId
    this.scope = scope
  }

  checkExists(config: MCPServerConfig) {
    const { name } = config
    const url = this.#getUrl(config)

    return ResultAsync.fromPromise(
      this.#db.query.mcpServerConfig.findFirst({
        where: (table) => {
          const baseConditions = [
            eq(table.userId, this.userId),
            eq(table.scope, this.scope),
            isNull(table.deletedAt),
          ] as const

          if (url) {
            return and(...baseConditions, or(eq(table.name, name), eq(table.url, url)))
          }

          return and(...baseConditions, eq(table.name, name))
        },
        columns: { id: true },
      }),
      (error) => coerceError('check config existence', error),
    ).map((result) => result !== undefined)
  }

  create(config: MCPServerConfig) {
    const rowResult = this.#toInsertRow(config)
    if (rowResult.isErr()) {
      return errAsync(rowResult.error)
    }

    return ResultAsync.fromPromise(
      this.#db.insert(mcpServerConfig).values(rowResult.value).returning({ id: mcpServerConfig.id }),
      (error) => coerceError('create MCP server config', error),
    ).andThen((rows) => {
      const first = rows.at(0)
      if (!first) {
        return errAsync(new Error('Insert succeeded but no identifier was returned'))
      }
      return okAsync(first.id)
    })
  }

  update(id: number, updateValue: MCPServerConfig) {
    let payload: Partial<MCPServerConfigRow>
    try {
      payload = this.#toUpdatePayload(updateValue)
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
      (error) => coerceError('update MCP server config', error),
    ).map(() => undefined)
  }

  getMany() {
    return ResultAsync.fromPromise(
      this.#db.query.mcpServerConfig.findMany({
        where: (table, { and, eq, isNull }) =>
          and(eq(table.userId, this.userId), eq(table.scope, this.scope), isNull(table.deletedAt)),
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
    if (config.transport === 'stdio') {
      return err(unsupportedTransportError(config.transport))
    }

    return ok({
      userId: this.userId,
      scope: this.scope,
      name: config.name,
      transport: config.transport,
      url: config.url,
      requestInit: config.requestInit ?? null,
    })
  }

  #toUpdatePayload(config: MCPServerConfig) {
    if (config.transport === 'stdio') {
      throw unsupportedTransportError(config.transport)
    }

    return {
      name: config.name,
      transport: config.transport,
      url: config.url,
      requestInit: config.requestInit ?? null,
    }
  }

  #getUrl(config: MCPServerConfig) {
    if (config.transport === 'streamable_http' || config.transport === 'sse') {
      return config.url
    }
    return undefined
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
