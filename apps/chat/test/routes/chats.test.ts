import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey'
import { testClient } from 'hono/testing'
import { beforeAll, vi } from 'vitest'
import app from '../../src/routes'
import { consola } from 'consola'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { resolve } from 'node:path'
import { beforeEach } from 'node:test'

let pgContainer: StartedPostgreSqlContainer
let valkeyContainer: StartedValkeyContainer
let db: typeof import('../../src/db').db
let testApp: ReturnType<typeof testClient<typeof app>>

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres').start()
  valkeyContainer = await new ValkeyContainer('valkey/glide').start()

  vi.stubEnv('DATABASE_URL', pgContainer.getConnectionUri())
  vi.stubEnv('VALKEY_ADDRESSES', JSON.stringify([`${valkeyContainer.getHost()}:${valkeyContainer.getPort()}`]))

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
