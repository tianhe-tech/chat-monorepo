import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey'
import { createMCPHubUseCase } from '../../app/use-case/mcp-hub'
import { afterAll, beforeAll, test, vi } from 'vitest'
import { resolve } from 'node:path'
import { UserMCPServerConfigRepoImpl } from '../../infra/mcp-server-config-repo'
import { MCPHubCacheKeyRegistry } from '../service/mcp-hub-cache'

let pgContainer: StartedPostgreSqlContainer
let valkeyContainer: StartedValkeyContainer
let db: typeof import('../../infra/db').db
let usecase: ReturnType<Awaited<ReturnType<typeof createMCPHubUseCase>>['_unsafeUnwrap']>

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres').start()
  valkeyContainer = await new ValkeyContainer('valkey/valkey').start()

  vi.stubEnv('PG_CONNECTION_STRING', pgContainer.getConnectionUri())
  vi.stubEnv('VALKEY_ADDRESSES', `[${valkeyContainer.getHost()}:${valkeyContainer.getPort()}]`)

  db = (await import('../../infra/db')).db
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../../drizzle') })

  const userId = 'test-user-id'
  const scope = 'test-scope'

  usecase = (
    await createMCPHubUseCase({
      repo: new UserMCPServerConfigRepoImpl({ userId, scope, db }),
      mcpHubCacheKeyRegistry: new MCPHubCacheKeyRegistry({ userId, scope }),
      threadId: 'test-thread-id',
    })
  )._unsafeUnwrap()
})

afterAll(async () => {
  await pgContainer.stop()
  await valkeyContainer.stop()
  await db.$client.end()
})

test('pass', () => {})
