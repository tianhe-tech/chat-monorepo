import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { consola } from 'consola'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { testClient } from 'hono/testing'
import { resolve } from 'node:path'
import { inspect } from 'node:util'
import { v4 as uuid } from 'uuid'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as schema from '../../src/db/schema'
import type honoApp from '../../src/routes'

let pgContainer: StartedPostgreSqlContainer
let db: typeof import('../../src/db').db
let testApp: ReturnType<typeof testClient<typeof honoApp>>

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres').start()

  vi.stubEnv('PG_CONNECTION_STRING', pgContainer.getConnectionUri())

  db = (await import('../../src/db')).db
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') })
  const app = (await import('../../src/routes')).default
  testApp = testClient(app)

  consola.wrapAll()
  consola.pauseLogs()
})

beforeEach(() => {
  consola.mockTypes(() => vi.fn())
})

afterAll(async () => {
  await db.$client.end()
  await pgContainer.stop()
})

beforeEach(async () => {
  await db.delete(schema.mcpServerConfig)
})

function requestCreate({ clientId, servers }: { clientId: string; servers: Array<{ name: string; url: string }> }) {
  return testApp.configs.$post(
    {
      json: {
        servers,
      },
    },
    {
      headers: {
        'mcp-client-id': clientId,
      },
    },
  )
}

function requestList({ clientId }: { clientId: string }) {
  return testApp.configs.$get(undefined, {
    headers: {
      'mcp-client-id': clientId,
    },
  })
}

function requestById({ clientId, configId }: { clientId: string; configId: number }) {
  return testApp.configs[':id'].$get(
    {
      param: {
        id: String(configId),
      },
    },
    {
      headers: {
        'mcp-client-id': clientId,
      },
    },
  )
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
  return testApp.configs[':id'].$put(
    {
      param: {
        id: String(configId),
      },
      json: updates,
    },
    {
      headers: {
        'mcp-client-id': clientId,
      },
    },
  )
}

function requestDelete({ clientId, ids }: { clientId: string; ids: number[] }) {
  return testApp.configs.$delete(
    {
      json: {
        ids,
      },
    },
    {
      headers: {
        'mcp-client-id': clientId,
      },
    },
  )
}

describe('Create', () => {
  test('creates a single config for a client', async () => {
    const res = await requestCreate({ clientId: uuid(), servers: [{ name: 'test', url: 'https://example.com' }] })
    expect(res.status, inspect(await res.json())).toBe(201)
    expect(await db.$count(schema.mcpServerConfig)).toBe(1)
  })

  test('creates multiple configs across repeated requests', async () => {
    const clientId = uuid()
    const items = Array.from({ length: 10 }).map((_, i) => ({ name: `test${i}`, url: `https://example.com/${i}` }))

    const results = await Promise.all(
      items.map((item) => requestCreate({ clientId, servers: [{ name: item.name, url: item.url }] })),
    )

    for (const res of results) {
      expect(res.status, inspect(await res.json())).toBe(201)
    }
    expect(await db.$count(schema.mcpServerConfig)).toBe(10)
  })

  test('creates multiple configs in a single request', async () => {
    const clientId = uuid()
    const servers = Array.from({ length: 10 }).map((_, i) => ({ name: `test${i}`, url: `https://example.com/${i}` }))
    const res = await requestCreate({ clientId, servers })
    expect(res.status, inspect(await res.json())).toBe(201)
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
      expect(res.status, inspect(await res.json())).toBe(201)
    }
    expect(await db.$count(schema.mcpServerConfig)).toBe(100)
  })

  test('rejects duplicate names for the same client', async () => {
    const clientId = uuid()
    const res1 = await requestCreate({ clientId, servers: [{ name: 'test', url: 'https://example.com' }] })
    expect(res1.status, inspect(await res1.json())).toBe(201)
    expect(await db.$count(schema.mcpServerConfig)).toBe(1)

    const res2 = await requestCreate({ clientId, servers: [{ name: 'test', url: 'https://example2.com' }] })
    expect(res2.status).toBe(400)
    expect(await db.$count(schema.mcpServerConfig)).toBe(1)
  })

  test('rejects duplicate urls for the same client', async () => {
    const clientId = uuid()
    const res1 = await requestCreate({ clientId, servers: [{ name: 'test', url: 'https://example.com' }] })
    expect(res1.status, inspect(await res1.json())).toBe(201)
    expect(await db.$count(schema.mcpServerConfig)).toBe(1)

    const res2 = await requestCreate({ clientId, servers: [{ name: 'test2', url: 'https://example.com' }] })
    expect(res2.status).toBe(400)
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
    expect(createRes.status, inspect(await createRes.json())).toBe(201)

    const res = await requestList({ clientId })
    const configs = await res.json()
    expect(res.status, inspect(configs)).toBe(200)
    expect(configs).toHaveLength(2)
    expect(configs.map((config) => config.name)).toEqual(expect.arrayContaining(['primary', 'secondary']))
  })

  test('returns a single config by id', async () => {
    const clientId = uuid()
    const createRes = await requestCreate({
      clientId,
      servers: [{ name: 'single', url: 'https://example.com' }],
    })

    const createdConfigs = await createRes.json()
    expect(createRes.status, inspect(createdConfigs)).toBe(201)
    const createdConfig = createdConfigs[0]

    const res = await requestById({ clientId, configId: createdConfig.id })
    const fetched = await res.json()
    expect(res.status, inspect(fetched)).toBe(200)
    expect(fetched.id).toBe(createdConfig.id)
    expect(fetched.name).toBe('single')
    expect(fetched.url).toBe('https://example.com')
  })

  test('returns 404 when config is missing', async () => {
    const clientId = uuid()
    const res = await requestById({ clientId, configId: 999_999 })
    expect(res.status).toBe(404)
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
    const createdConfigs = await createRes.json()
    expect(createRes.status, inspect(createdConfigs)).toBe(201)
    const [createdConfig] = createdConfigs

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
    const updated = await res.json()
    expect(res.status, inspect(updated)).toBe(200)
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
    const createdConfigs = await createRes.json()
    expect(createRes.status, inspect(createdConfigs)).toBe(201)
    const target = createdConfigs.find((config) => config.name === 'second')!

    const res = await requestUpdate({
      clientId,
      configId: target.id,
      updates: { name: 'first' },
    })
    expect(res.status).toBe(400)
  })

  test('responds with 404 when updating a missing config', async () => {
    const clientId = uuid()
    const res = await requestUpdate({
      clientId,
      configId: 1,
      updates: { name: 'missing' },
    })
    expect(res.status).toBe(404)
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
    const createdConfigs = await createRes.json()
    expect(createRes.status, inspect(createdConfigs)).toBe(201)
    const [first, second, third] = createdConfigs

    const res = await requestDelete({
      clientId,
      ids: [first.id, second.id],
    })
    const outcome = await res.json()
    expect(res.status, inspect(outcome)).toBe(200)
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
    expect(res.status).toBe(404)
  })
})
