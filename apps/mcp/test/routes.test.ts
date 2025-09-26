import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey'
import { v4 as uuid } from 'uuid'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import * as schema from '../src/db/schema'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { resolve } from 'node:path'

let pgContainer: StartedPostgreSqlContainer
let valkeyContainer: StartedValkeyContainer
let db: typeof import('../src/db').db
let app: typeof import('../src/index').default

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres').start()
  valkeyContainer = await new ValkeyContainer('valkey/valkey').start()

  process.env.PG_CONNECTION_STRING = pgContainer.getConnectionUri()
  process.env.VALKEY_ADDRESSES = JSON.stringify([valkeyContainer.getHost()])

  db = (await import('../src/db')).db
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') })
  app = (await import('../src/index')).default
})

afterAll(() =>
  Promise.all([
    valkeyContainer.stop(),
    (async () => {
      await db.$client.end()
      await pgContainer.stop()
    })(),
  ]),
)

describe('/configs', () => {
  beforeEach(async () => {
    await db.delete(schema.mcpServerConfig)
  })

  type ConfigRecord = {
    id: number
    name: string
    url: string
    requestInit?: { headers?: Record<string, string> } | null
    deletedAt?: string | null
  }

  function requestCreate({ clientId, servers }: { clientId: string; servers: Array<{ name: string; url: string }> }) {
    return app.request('/configs', {
      method: 'post',
      headers: {
        'content-type': 'application/json',
        'mcp-client-id': clientId,
      },
      body: JSON.stringify({
        servers,
      }),
    })
  }

  function requestList({ clientId }: { clientId: string }) {
    return app.request('/configs', {
      method: 'get',
      headers: {
        'mcp-client-id': clientId,
      },
    })
  }

  function requestById({ clientId, configId }: { clientId: string; configId: number }) {
    return app.request(`/configs/${configId}`, {
      method: 'get',
      headers: {
        'mcp-client-id': clientId,
      },
    })
  }

  function requestUpdate({
    clientId,
    configId,
    updates,
  }: {
    clientId: string
    configId: number
    updates: { name?: string; url?: string; headers?: Record<string, string> }
  }) {
    return app.request(`/configs/${configId}`, {
      method: 'put',
      headers: {
        'content-type': 'application/json',
        'mcp-client-id': clientId,
      },
      body: JSON.stringify(updates),
    })
  }

  function requestDelete({ clientId, ids }: { clientId: string; ids: number[] }) {
    return app.request('/configs', {
      method: 'delete',
      headers: {
        'content-type': 'application/json',
        'mcp-client-id': clientId,
      },
      body: JSON.stringify({ ids }),
    })
  }

  describe('Create', () => {
    test('creates a single config for a client', async () => {
      const res = await requestCreate({ clientId: uuid(), servers: [{ name: 'test', url: 'https://example.com' }] })
      expect(res).toMatchObject({ status: 201 })
      expect(await db.$count(schema.mcpServerConfig)).toBe(1)
    })

    test('creates multiple configs across repeated requests', async () => {
      const clientId = uuid()
      const items = Array.from({ length: 10 }).map((_, i) => ({ name: `test${i}`, url: `https://example.com/${i}` }))

      const results = await Promise.all(
        items.map((item) => requestCreate({ clientId, servers: [{ name: item.name, url: item.url }] })),
      )

      for (const res of results) {
        expect(res).toMatchObject({ status: 201 })
      }
      expect(await db.$count(schema.mcpServerConfig)).toBe(10)
    })

    test('creates multiple configs in a single request', async () => {
      const clientId = uuid()
      const servers = Array.from({ length: 10 }).map((_, i) => ({ name: `test${i}`, url: `https://example.com/${i}` }))
      const res = await requestCreate({ clientId, servers })
      expect(res).toMatchObject({ status: 201 })
      expect(await db.$count(schema.mcpServerConfig)).toBe(10)
    })

    test('creates batched configs across multiple requests', async () => {
      const clientId = uuid()
      const servers = Array.from({ length: 100 }).map((_, i) => ({ name: `test${i}`, url: `https://example.com/${i}` }))

      const results = await Promise.all(
        Array.from({ length: 10 }).map((_, i) =>
          requestCreate({ clientId, servers: servers.slice(i * 10, (i + 1) * 10) }),
        ),
      )

      for (const res of results) {
        expect(res).toMatchObject({ status: 201 })
      }
      expect(await db.$count(schema.mcpServerConfig)).toBe(100)
    })

    test('rejects duplicate names for the same client', async () => {
      const clientId = uuid()
      const res1 = await requestCreate({ clientId, servers: [{ name: 'test', url: 'https://example.com' }] })
      expect(res1).toMatchObject({ status: 201 })
      expect(await db.$count(schema.mcpServerConfig)).toBe(1)

      const res2 = await requestCreate({ clientId, servers: [{ name: 'test', url: 'https://example2.com' }] })
      expect(res2).toMatchObject({ status: 400 })
      expect(await db.$count(schema.mcpServerConfig)).toBe(1)
    })

    test('rejects duplicate urls for the same client', async () => {
      const clientId = uuid()
      const res1 = await requestCreate({ clientId, servers: [{ name: 'test', url: 'https://example.com' }] })
      expect(res1).toMatchObject({ status: 201 })
      expect(await db.$count(schema.mcpServerConfig)).toBe(1)

      const res2 = await requestCreate({ clientId, servers: [{ name: 'test2', url: 'https://example.com' }] })
      expect(res2).toMatchObject({ status: 400 })
      expect(await db.$count(schema.mcpServerConfig)).toBe(1)
    })
  })

  describe('Read', () => {
    test('lists configs for the authenticated user', async () => {
      const clientId = uuid()
      const createRes = await requestCreate({
        clientId,
        servers: [
          { name: 'primary', url: 'https://example.com' },
          { name: 'secondary', url: 'https://example.org' },
        ],
      })
      expect(createRes).toMatchObject({ status: 201 })

      const res = await requestList({ clientId })
      expect(res).toMatchObject({ status: 200 })
      const configs = (await res.json()) as ConfigRecord[]
      expect(configs).toHaveLength(2)
      expect(configs.map((config) => config.name)).toEqual(expect.arrayContaining(['primary', 'secondary']))
    })

    test('returns a single config by id', async () => {
      const clientId = uuid()
      const createRes = await requestCreate({
        clientId,
        servers: [{ name: 'single', url: 'https://example.com' }],
      })
      expect(createRes).toMatchObject({ status: 201 })
      const createdConfigs = (await createRes.json()) as ConfigRecord[]
      const createdConfig = createdConfigs[0]

      const res = await requestById({ clientId, configId: createdConfig.id })
      expect(res).toMatchObject({ status: 200 })
      const fetched = (await res.json()) as ConfigRecord
      expect(fetched.id).toBe(createdConfig.id)
      expect(fetched.name).toBe('single')
      expect(fetched.url).toBe('https://example.com')
    })

    test('returns 404 when config is missing', async () => {
      const clientId = uuid()
      const res = await requestById({ clientId, configId: 999_999 })
      expect(res).toMatchObject({ status: 404 })
    })
  })

  describe('Update', () => {
    test('updates config fields and request headers', async () => {
      const clientId = uuid()
      const createRes = await requestCreate({
        clientId,
        servers: [
          {
            name: 'updatable',
            url: 'https://example.com',
          },
        ],
      })
      expect(createRes).toMatchObject({ status: 201 })
      const [createdConfig] = (await createRes.json()) as ConfigRecord[]

      const res = await requestUpdate({
        clientId,
        configId: createdConfig.id,
        updates: {
          name: 'updated-name',
          url: 'https://example.org',
          headers: {
            Authorization: 'Bearer token',
          },
        },
      })
      expect(res).toMatchObject({ status: 200 })
      const updated = (await res.json()) as ConfigRecord
      expect(updated.name).toBe('updated-name')
      expect(updated.url).toBe('https://example.org')
      expect(updated.requestInit?.headers).toEqual({ Authorization: 'Bearer token' })

      const stored = await db.query.mcpServerConfig.findFirst({
        where: (config, { and, eq, isNull }) => and(eq(config.id, createdConfig.id), isNull(config.deletedAt)),
      })
      expect(stored?.name).toBe('updated-name')
      expect(stored?.url).toBe('https://example.org')
      expect(stored?.requestInit?.headers).toEqual({ Authorization: 'Bearer token' })
    })

    test('responds with 400 when updating to a duplicate name', async () => {
      const clientId = uuid()
      const createRes = await requestCreate({
        clientId,
        servers: [
          { name: 'first', url: 'https://example.com/1' },
          { name: 'second', url: 'https://example.com/2' },
        ],
      })
      expect(createRes).toMatchObject({ status: 201 })
      const createdConfigs = (await createRes.json()) as ConfigRecord[]
      const target = createdConfigs.find((config) => config.name === 'second')!

      const res = await requestUpdate({
        clientId,
        configId: target.id,
        updates: { name: 'first' },
      })
      expect(res).toMatchObject({ status: 400 })
    })

    test('responds with 404 when updating a missing config', async () => {
      const clientId = uuid()
      const res = await requestUpdate({
        clientId,
        configId: 1,
        updates: { name: 'missing' },
      })
      expect(res).toMatchObject({ status: 404 })
    })
  })

  describe('Delete', () => {
    test('soft deletes configs and returns counts', async () => {
      const clientId = uuid()
      const createRes = await requestCreate({
        clientId,
        servers: [
          { name: 'one', url: 'https://example.com/1' },
          { name: 'two', url: 'https://example.com/2' },
          { name: 'three', url: 'https://example.com/3' },
        ],
      })
      expect(createRes).toMatchObject({ status: 201 })
      const createdConfigs = (await createRes.json()) as ConfigRecord[]
      const [first, second, third] = createdConfigs

      const res = await requestDelete({
        clientId,
        ids: [first.id, second.id],
      })
      expect(res).toMatchObject({ status: 200 })
      const outcome = (await res.json()) as { deleted: number; notFound: number[] }
      expect(outcome.deleted).toBe(2)
      expect(outcome.notFound).toHaveLength(0)

      const deletedRecords = await db.query.mcpServerConfig.findMany({
        where: (config, { inArray }) => inArray(config.id, [first.id, second.id]),
      })
      for (const record of deletedRecords) {
        expect(record.deletedAt).not.toBeNull()
      }

      const activeConfigs = await db.query.mcpServerConfig.findMany({
        where: (config, { and, eq, isNull }) => and(eq(config.id, third.id), isNull(config.deletedAt)),
      })
      expect(activeConfigs).toHaveLength(1)
    })

    test('returns 404 when none of the ids exist', async () => {
      const clientId = uuid()
      const res = await requestDelete({ clientId, ids: [1, 2] })
      expect(res).toMatchObject({ status: 404 })
    })
  })
})
