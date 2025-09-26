import { test } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import * as schema from '../../src/db/schema'
import { resolve } from 'node:path'

export const testWithContainers = test.extend<{
  pg: StartedPostgreSqlContainer
  valkey: StartedValkeyContainer
  db: ReturnType<typeof drizzle>
}>({
  pg: async (_, use) => {
    const container = await new PostgreSqlContainer('postgres').start()
    await use(container)
    await container.stop()
  },
  valkey: async (_, use) => {
    const container = await new ValkeyContainer('valkey/valkey').start()
    await use(container)
    await container.stop()
  },
  db: async ({ pg }, use) => {
    const db = drizzle({ connection: pg.getConnectionUri(), schema, casing: 'snake_case' })
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') })
    await use(db)
    await db.$client.end()
  },
})
