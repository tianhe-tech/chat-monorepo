import type { MCPServerConfig } from '@internal/shared/contracts/mcp-server-config'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { consola } from 'consola'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { resolve } from 'node:path'
import { inspect } from 'node:util'
import { v4 as uuid } from 'uuid'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as schema from '../../src/infra/db/schema'

let pgContainer: StartedPostgreSqlContainer
let db: typeof import('../../src/infra/db').db | undefined
let app: Hono

const jsonHeaders = { 'content-type': 'application/json' } as const

const closeDb = async () => {
  if (!db) {
    return
  }
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client
  if (client) {
    await client.end()
  }
}

const buildConfig = (overrides: Partial<MCPServerConfig> = {}): MCPServerConfig => ({
  name: `mcphub-${uuid()}`,
  transport: 'streamable_http',
  url: `https://example.com/${uuid()}`,
  requestInit: {
    headers: {
      Authorization: 'Bearer token',
    },
  },
  ...(overrides as any),
})

const createConfig = (config: MCPServerConfig) =>
  app.request('/api/configs', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(config),
  })

const listConfigs = () => app.request('/api/configs')

const getConfigById = (id: number) => app.request(`/api/configs/${id}`)

const updateConfig = (id: number, config: MCPServerConfig) =>
  app.request(`/api/configs/${id}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(config),
  })

const deleteConfig = (id: number) =>
  app.request(`/api/configs/${id}`, {
    method: 'DELETE',
  })

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres').start()

  vi.stubEnv('PG_CONNECTION_STRING', pgContainer.getConnectionUri())
  vi.stubEnv('TRUSTED_MCP_ORIGINS', JSON.stringify([]))
  vi.stubEnv('VALKEY_ADDRESSES', JSON.stringify(['127.0.0.1:6379']))

  db = (await import('../../src/infra/db')).db
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') })
  app = (await import('../../src/app/routes')).default

  consola.wrapAll()
  consola.pauseLogs()
})

beforeEach(() => {
  consola.mockTypes(() => vi.fn())
})

beforeEach(async () => {
  await db!.delete(schema.mcpServerConfig)
})

afterAll(async () => {
  await closeDb()
  await pgContainer.stop()
  vi.unstubAllEnvs()
})

describe('POST /api/configs', () => {
  test('creates a config for the default user', async () => {
    const payload = buildConfig({ name: 'primary', url: 'https://example.com/primary' })
    const res = await createConfig(payload)
    expect(res.status, inspect(await res.clone().json())).toBe(201)

    const id = (await res.json()) as number
    expect(typeof id).toBe('number')

    const stored = await db!.query.mcpServerConfig.findFirst({
      where: (table, op) => op.eq(table.id, id),
    })
    expect(stored).toMatchObject({
      name: 'primary',
      transport: 'streamable_http',
      url: 'https://example.com/primary',
      deletedAt: null,
    })
  })

  test('rejects duplicate config names within the same scope', async () => {
    const payload = buildConfig({ name: 'duplicate', url: 'https://example.com/one' })
    const first = await createConfig(payload)
    expect(first.status).toBe(201)

    const second = await createConfig(buildConfig({ name: 'duplicate', url: 'https://example.com/two' }))
    expect(second.status).toBe(400)

    const records = await db!.select().from(schema.mcpServerConfig)
    expect(records).toHaveLength(1)
  })

  test('rejects duplicate config URLs within the same scope', async () => {
    const payload = buildConfig({ name: 'url-first', url: 'https://example.com/shared' })
    const first = await createConfig(payload)
    expect(first.status).toBe(201)

    const second = await createConfig(buildConfig({ name: 'url-second', url: 'https://example.com/shared' }))
    expect(second.status).toBe(400)

    const records = await db!.select().from(schema.mcpServerConfig)
    expect(records).toHaveLength(1)
  })
})

describe('GET /api/configs', () => {
  test('lists configs for the authenticated user', async () => {
    const first = buildConfig({ name: 'alpha', url: 'https://example.com/alpha' })
    const second = buildConfig({ name: 'beta', url: 'https://example.com/beta' })

    expect((await createConfig(first)).status).toBe(201)
    expect((await createConfig(second)).status).toBe(201)

    const res = await listConfigs()
    expect(res.status).toBe(200)
    const configs = (await res.json()) as Array<MCPServerConfig & { id: number }>
    expect(configs).toHaveLength(2)
    expect(configs.map((config) => config.name)).toEqual(expect.arrayContaining(['alpha', 'beta']))
    for (const config of configs) {
      expect(config.id).toBeGreaterThan(0)
    }
  })

  test('returns a single config by id', async () => {
    const payload = buildConfig({ name: 'single', url: 'https://example.com/single' })
    const createRes = await createConfig(payload)
    expect(createRes.status).toBe(201)
    const createdId = (await createRes.json()) as number

    const res = await getConfigById(createdId)
    expect(res.status, inspect(await res.clone().json())).toBe(200)
    const config = (await res.json()) as MCPServerConfig & { id: number }
    expect(config).toMatchObject({
      id: createdId,
      name: 'single',
      transport: 'streamable_http',
      url: 'https://example.com/single',
    })
  })

  test('responds with 404 when config is missing', async () => {
    const res = await getConfigById(999_999)
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/configs/:id', () => {
  test('updates config fields and clears cache', async () => {
    const payload = buildConfig({ name: 'updatable', url: 'https://example.com/updatable' })
    const createRes = await createConfig(payload)
    expect(createRes.status).toBe(201)
    const id = (await createRes.json()) as number

    const updatedPayload = buildConfig({
      name: 'updated',
      url: 'https://example.com/updated',
      requestInit: { headers: { Authorization: 'Bearer updated-token' } },
    })

    const res = await updateConfig(id, updatedPayload)
    expect(res.status).toBe(204)

    const stored = await db!.query.mcpServerConfig.findFirst({
      where: (table, op) => op.eq(table.id, id),
    })
    expect(stored).toMatchObject({
      name: 'updated',
      url: 'https://example.com/updated',
      requestInit: { headers: { Authorization: 'Bearer updated-token' } },
    })
  })

  test('responds with 404 when updating a missing config', async () => {
    const res = await updateConfig(1, buildConfig({ name: 'missing', url: 'https://example.com/missing' }))
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/configs/:id', () => {
  test('soft deletes the config and excludes it from listings', async () => {
    const payload = buildConfig({ name: 'deletable', url: 'https://example.com/deletable' })
    const createRes = await createConfig(payload)
    expect(createRes.status).toBe(201)
    const id = (await createRes.json()) as number

    const res = await deleteConfig(id)
    expect(res.status).toBe(204)

    const deletedRows = await db!.select().from(schema.mcpServerConfig).where(eq(schema.mcpServerConfig.id, id))
    const [deleted] = deletedRows
    expect(deleted?.deletedAt).not.toBeNull()

    const listRes = await listConfigs()
    expect(listRes.status).toBe(200)
    const configs = (await listRes.json()) as Array<MCPServerConfig & { id: number }>
    expect(configs.find((config) => config.id === id)).toBeUndefined()
  })

  test('responds with 404 when deleting a missing config', async () => {
    const res = await deleteConfig(42)
    expect(res.status).toBe(404)
  })
})
