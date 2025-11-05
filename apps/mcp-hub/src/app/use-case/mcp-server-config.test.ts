import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi, beforeEach } from 'vitest'
import { UserMCPServerConfigRepoImpl } from '../../infra/mcp-server-config-repo'
import { DuplicateConfigError, NotFoundError, createMCPServerConfigUseCase } from './mcp-server-config'
import { inspect } from 'node:util'
import * as Schema from '../../infra/db/schema'
import assert from 'node:assert'

let pgContainer: StartedPostgreSqlContainer
let db: typeof import('../../infra/db').db
let usecase: ReturnType<typeof createMCPServerConfigUseCase>

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres').start()

  vi.stubEnv('PG_CONNECTION_STRING', pgContainer.getConnectionUri())

  db = (await import('../../infra/db')).db
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../../drizzle') })

  const userId = 'test-user-id'
  const scope = 'test-scope'

  usecase = createMCPServerConfigUseCase({
    repo: new UserMCPServerConfigRepoImpl({ userId, scope, db }),
  })
})

afterAll(async () => {
  await db.$client.end()
  await pgContainer.stop()
})

beforeEach(async () => {
  await db.delete(Schema.mcpServerConfig)
})

describe('Create and retrieve configs', () => {
  test('Creates streamable http transport', async () => {
    const serverConfig = {
      name: 'streamable http test',
      transport: 'streamable_http',
      url: 'https://example.com',
    } as const
    const create = await usecase.upsert({ serverConfig })
    expect(create.isOk(), inspect(create)).toBe(true)

    const retrieve = await usecase.getById({ id: create._unsafeUnwrap() })
    expect(retrieve.isOk(), inspect(retrieve)).toBe(true)
    expect(retrieve._unsafeUnwrap()).toMatchObject(serverConfig)
  })

  test('Creates sse transport', async () => {
    const serverConfig = {
      name: 'sse test',
      transport: 'sse',
      url: 'https://example.com',
    } as const
    const create = await usecase.upsert({ serverConfig })
    expect(create.isOk(), inspect(create)).toBe(true)

    const retrieve = await usecase.getById({ id: create._unsafeUnwrap() })
    expect(retrieve.isOk(), inspect(retrieve)).toBe(true)
    expect(retrieve._unsafeUnwrap()).toMatchObject(serverConfig)
  })

  test('Creates stdio transport', async () => {
    const serverConfig = {
      name: 'stdio test',
      transport: 'stdio' as const,
      command: ['node', 'server.js'],
    }
    const create = await usecase.upsert({ serverConfig })
    expect(create.isOk(), inspect(create)).toBe(true)

    const retrieve = await usecase.getById({ id: create._unsafeUnwrap() })
    expect(retrieve.isOk(), inspect(retrieve)).toBe(true)
    expect(retrieve._unsafeUnwrap()).toMatchObject(serverConfig)
  })

  test('Creates and retrieves all 3 transport types, returning in reverse creation order', async () => {
    const transports = [
      {
        name: 'streamable http config',
        transport: 'streamable_http' as const,
        url: 'https://api.example.com',
      },
      {
        name: 'sse config',
        transport: 'sse' as const,
        url: 'https://events.example.com',
      },
      {
        name: 'stdio config',
        transport: 'stdio' as const,
        command: ['python', 'main.py'],
      },
    ]

    const ids: number[] = []
    for (const serverConfig of transports) {
      const create = await usecase.upsert({ serverConfig })
      expect(create.isOk(), inspect(create)).toBe(true)
      ids.push(create._unsafeUnwrap())
    }

    const retrieve = await usecase.getMany()
    expect(retrieve.isOk(), inspect(retrieve)).toBe(true)
    const configs = retrieve._unsafeUnwrap()
    expect(configs).toHaveLength(3)
    for (let i = 0; i < transports.length; i++) {
      expect(configs[transports.length - i - 1]).toMatchObject(transports[i])
    }
  })

  test('Rejects duplicate config when name already exists in scope', async () => {
    const firstConfig = {
      name: 'duplicate name test',
      transport: 'sse' as const,
      url: 'https://primary.example.com',
    }

    const createFirst = await usecase.upsert({ serverConfig: firstConfig })
    expect(createFirst.isOk(), inspect(createFirst)).toBe(true)

    const duplicateAttempt = await usecase.upsert({
      serverConfig: {
        name: firstConfig.name,
        transport: 'sse',
        url: 'https://secondary.example.com',
      },
    })

    expect(duplicateAttempt.isErr()).toBe(true)
    const duplicateError = duplicateAttempt._unsafeUnwrapErr()
    expect(duplicateError).toBeInstanceOf(DuplicateConfigError)

    const all = await usecase.getMany()
    expect(all.isOk(), inspect(all)).toBe(true)
    expect(all._unsafeUnwrap()).toHaveLength(1)
  })

  test('Rejects duplicate sse config when url already exists in scope', async () => {
    const createFirst = await usecase.upsert({
      serverConfig: {
        name: 'url baseline sse',
        transport: 'sse' as const,
        url: 'https://duplicate-url.example.com',
      },
    })
    expect(createFirst.isOk(), inspect(createFirst)).toBe(true)

    const duplicateAttempt = await usecase.upsert({
      serverConfig: {
        name: 'url duplicate sse',
        transport: 'sse' as const,
        url: 'https://duplicate-url.example.com',
      },
    })

    expect(duplicateAttempt.isErr()).toBe(true)
    expect(duplicateAttempt._unsafeUnwrapErr()).toBeInstanceOf(DuplicateConfigError)

    const all = await usecase.getMany()
    expect(all.isOk(), inspect(all)).toBe(true)
    const configs = all._unsafeUnwrap()
    expect(configs).toHaveLength(1)
    expect(configs[0]).toMatchObject({
      name: 'url baseline sse',
      url: 'https://duplicate-url.example.com',
    })
  })

  test('Rejects duplicate streamable http config when url already exists in scope', async () => {
    const createFirst = await usecase.upsert({
      serverConfig: {
        name: 'url baseline streamable',
        transport: 'streamable_http' as const,
        url: 'https://duplicate-stream.example.com',
      },
    })
    expect(createFirst.isOk(), inspect(createFirst)).toBe(true)

    const duplicateAttempt = await usecase.upsert({
      serverConfig: {
        name: 'url duplicate streamable',
        transport: 'streamable_http' as const,
        url: 'https://duplicate-stream.example.com',
      },
    })

    expect(duplicateAttempt.isErr()).toBe(true)
    expect(duplicateAttempt._unsafeUnwrapErr()).toBeInstanceOf(DuplicateConfigError)

    const all = await usecase.getMany()
    expect(all.isOk(), inspect(all)).toBe(true)
    const configs = all._unsafeUnwrap()
    expect(configs).toHaveLength(1)
    expect(configs[0]).toMatchObject({
      name: 'url baseline streamable',
      url: 'https://duplicate-stream.example.com',
    })
  })

  test('Rejects duplicate stdio config when command matches', async () => {
    const firstConfig = {
      name: 'stdio baseline',
      transport: 'stdio' as const,
      command: ['node', 'worker.mjs'],
    }

    const createFirst = await usecase.upsert({ serverConfig: firstConfig })
    expect(createFirst.isOk(), inspect(createFirst)).toBe(true)

    const duplicateAttempt = await usecase.upsert({
      serverConfig: {
        name: 'different name allowed',
        transport: 'stdio' as const,
        command: ['node', 'worker.mjs'],
      },
    })

    expect(duplicateAttempt.isErr()).toBe(true)
    const duplicateError = duplicateAttempt._unsafeUnwrapErr()
    expect(duplicateError).toBeInstanceOf(DuplicateConfigError)

    const byId = await usecase.getById({ id: createFirst._unsafeUnwrap() })
    expect(byId.isOk(), inspect(byId)).toBe(true)
    expect(byId._unsafeUnwrap()).toMatchObject(firstConfig)
  })
})

describe('Update configs', () => {
  test('Updates an existing config', async () => {
    const initialConfig = {
      name: 'updatable config',
      transport: 'streamable_http' as const,
      url: 'https://initial.example.com',
    }

    const create = await usecase.upsert({ serverConfig: initialConfig })
    expect(create.isOk(), inspect(create)).toBe(true)
    const id = create._unsafeUnwrap()

    const updatedConfig = {
      name: 'updated config',
      transport: 'streamable_http' as const,
      url: 'https://updated.example.com',
      requestInit: {
        headers: {
          Authorization: 'Bearer token',
        },
      },
    }

    const update = await usecase.upsert({ serverConfig: { ...updatedConfig, id } })
    expect(update.isOk(), inspect(update)).toBe(true)

    const retrieve = await usecase.getById({ id })
    expect(retrieve.isOk(), inspect(retrieve)).toBe(true)
    expect(retrieve._unsafeUnwrap()).toMatchObject(updatedConfig)
  })

  test('Returns not found error when updating missing config', async () => {
    const update = await usecase.upsert({
      serverConfig: {
        id: 99999,
        name: 'missing',
        transport: 'sse' as const,
        url: 'https://missing.example.com',
      },
    })

    expect(update.isErr()).toBe(true)
    const error = update._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(NotFoundError)
  })

  test('Rejects updates that duplicate an existing name', async () => {
    const first = await usecase.upsert({
      serverConfig: {
        name: 'primary name',
        transport: 'sse' as const,
        url: 'https://primary-name.example.com',
      },
    })
    const second = await usecase.upsert({
      serverConfig: {
        name: 'secondary name',
        transport: 'streamable_http' as const,
        url: 'https://secondary-url.example.com',
      },
    })
    expect(first.isOk() && second.isOk(), inspect({ first, second })).toBe(true)

    const secondId = second._unsafeUnwrap()
    const update = await usecase.upsert({
      serverConfig: {
        id: secondId,
        name: 'primary name',
        transport: 'streamable_http' as const,
        url: 'https://secondary-url.example.com',
      },
    })

    expect(update.isErr()).toBe(true)
    const error = update._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(DuplicateConfigError)

    const verify = await usecase.getById({ id: secondId })
    expect(verify.isOk(), inspect(verify)).toBe(true)
    expect(verify._unsafeUnwrap()).toMatchObject({
      name: 'secondary name',
      url: 'https://secondary-url.example.com',
    })
  })

  test('Rejects updates that duplicate an existing url', async () => {
    const first = await usecase.upsert({
      serverConfig: {
        name: 'url owner',
        transport: 'sse' as const,
        url: 'https://shared-url.example.com',
      },
    })
    const second = await usecase.upsert({
      serverConfig: {
        name: 'url updater',
        transport: 'streamable_http' as const,
        url: 'https://second-url.example.com',
      },
    })
    expect(first.isOk() && second.isOk(), inspect({ first, second })).toBe(true)

    const secondId = second._unsafeUnwrap()
    const update = await usecase.upsert({
      serverConfig: {
        id: secondId,
        name: 'url updater',
        transport: 'streamable_http' as const,
        url: 'https://shared-url.example.com',
      },
    })

    expect(update.isErr()).toBe(true)
    const error = update._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(DuplicateConfigError)

    const verify = await usecase.getById({ id: secondId })
    expect(verify.isOk(), inspect(verify)).toBe(true)
    expect(verify._unsafeUnwrap()).toMatchObject({
      name: 'url updater',
      url: 'https://second-url.example.com',
    })
  })
})

describe('Delete configs', () => {
  test('Soft deletes an existing config and prevents further access', async () => {
    const serverConfig = {
      name: 'deletable config',
      transport: 'sse' as const,
      url: 'https://delete-me.example.com',
    }

    const create = await usecase.upsert({ serverConfig })
    expect(create.isOk(), inspect(create)).toBe(true)
    const id = create._unsafeUnwrap()

    const deletion = await usecase.delete({ id })
    expect(deletion.isOk(), inspect(deletion)).toBe(true)

    const retrieve = await usecase.getById({ id })
    expect(retrieve.isOk(), inspect(retrieve)).toBe(true)
    expect(retrieve._unsafeUnwrap()).toBeUndefined()

    const secondDeletion = await usecase.delete({ id })
    expect(secondDeletion.isErr()).toBe(true)
    const error = secondDeletion._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(NotFoundError)
  })

  test('Returns not found error when deleting missing config', async () => {
    const deletion = await usecase.delete({ id: 424242 })

    expect(deletion.isErr()).toBe(true)
    const error = deletion._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(NotFoundError)
  })
})
