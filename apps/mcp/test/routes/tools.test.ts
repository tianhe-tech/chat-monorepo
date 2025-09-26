import type { CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types.js'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey'
import { GlideClient, GlideClientConfiguration } from '@valkey/valkey-glide'
import { consola } from 'consola'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { resolve } from 'node:path'
import { v4 as uuid } from 'uuid'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import * as schema from '../../src/db/schema'
import { MCPMessageChannels } from '../../src/mcp'
import { spinUpFixtureMCPServer } from '@repo/test-utils'

let pgContainer: StartedPostgreSqlContainer
let valkeyContainer: StartedValkeyContainer
let db: typeof import('../../src/db').db
let app: typeof import('../../src/routes').default

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres').start()
  valkeyContainer = await new ValkeyContainer('valkey/valkey').start()

  vi.stubEnv('PG_CONNECTION_STRING', pgContainer.getConnectionUri())
  vi.stubEnv('VALKEY_ADDRESSES', JSON.stringify([`${valkeyContainer.getHost()}:${valkeyContainer.getPort()}`]))

  db = (await import('../../src/db')).db
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') })
  app = (await import('../../src/routes')).default

  consola.wrapAll()
  consola.pauseLogs()
})

beforeEach(() => {
  consola.mockTypes(() => vi.fn())
})

afterAll(async () => {
  await Promise.all([
    valkeyContainer.stop(),
    (async () => {
      await db.$client.end()
      await pgContainer.stop()
    })(),
  ])
})

beforeEach(async () => {
  await db.delete(schema.mcpServerConfig)
})

let cleanupMCPServer: () => void
const MCP_SERVER_PORT = 8765

beforeAll(async () => {
  const { teardown } = await spinUpFixtureMCPServer({ port: MCP_SERVER_PORT })
  cleanupMCPServer = teardown
})

afterAll(() => {
  cleanupMCPServer()
})

let valkeySub: GlideClient
const valkeySubLogger = consola.withTag('valkey-sub')

beforeAll(async () => {
  valkeySubLogger.mockTypes(() => vi.fn())
  valkeySub = await GlideClient.createClient({
    addresses: [{ host: valkeyContainer.getHost(), port: valkeyContainer.getPort() }],
    pubsubSubscriptions: {
      channelsAndPatterns: {
        [GlideClientConfiguration.PubSubChannelModes.Exact]: new Set(Object.values(MCPMessageChannels)),
      },
      callback: ({ channel, message }) => {
        valkeySubLogger.log({ channel: channel.toString(), message: message.toString() })
      },
    },
  })
})

afterAll(() => {
  valkeySub.close()
})

beforeEach(() => {
  valkeySubLogger.mockTypes(() => vi.fn())
})

const serverName = 'fixture'
const serverBaseUrl = `http://localhost:${MCP_SERVER_PORT}`

beforeEach(async () => {
  await db.delete(schema.mcpServerConfig)
  await db.insert(schema.mcpServerConfig).values({
    name: serverName,
    url: `${serverBaseUrl}/mcp`,
    transport: 'streamable_http',
    userId: 'default',
    scope: 'global',
  })
})

function requestListTools({ threadId, refresh = false }: { threadId: string; refresh?: boolean }) {
  const search = refresh ? '?refresh=true' : ''
  return app.request(`/tools${search}`, {
    method: 'get',
    headers: {
      'mcp-thread-id': threadId,
    },
  })
}

function requestCallTool({ threadId, name, args }: { threadId: string; name: string; args?: Record<string, unknown> }) {
  return app.request('/tools', {
    method: 'post',
    headers: {
      'content-type': 'application/json',
      'mcp-thread-id': threadId,
    },
    body: JSON.stringify({
      name,
      arguments: args,
    }),
  })
}

test('list tools', async () => {
  const threadId = uuid()
  const res = await requestListTools({ threadId, refresh: true })
  expect(res.status).toBe(200)
  const toolMap = (await res.json()) as Record<string, Array<{ name: string }>>
  expect(toolMap).toHaveProperty(serverName)
  const serverTools = toolMap[serverName]
  expect(Array.isArray(serverTools)).toBe(true)
  expect(serverTools.length).toBeGreaterThan(0)
})

describe('call tools', () => {
  let subLoggerMock: Mock
  beforeEach(() => {
    subLoggerMock = valkeySubLogger.log as unknown as Mock
  })

  describe('basic', () => {
    test('http response and valkey channel', async () => {
      const threadId = uuid()

      const listRes = await requestListTools({ threadId, refresh: true })
      expect(listRes.status).toBe(200)
      const toolMap = (await listRes.json()) as Record<string, Array<{ name: string }>>
      expect(toolMap).toHaveProperty(serverName)
      const serverTools = toolMap[serverName]
      expect(Array.isArray(serverTools)).toBe(true)
      const echoTool = serverTools.find((tool) => tool.name === 'echo')
      expect(echoTool).toBeDefined()

      const callRes = await requestCallTool({
        threadId,
        name: `${serverName}_echo`,
        args: { text: 'ping' },
      })
      expect(callRes.status).toBe(200)
      const res = (await callRes.json()) as CallToolResult

      expect(res.content).toMatchObject([{ type: 'text', text: 'ping' } as TextContent])

      await expect.poll(() => subLoggerMock, { interval: 100, timeout: 1000 }).toHaveBeenCalledOnce()
      const subMessage = JSON.stringify(subLoggerMock.mock.calls)
      expect(subMessage).toContain(MCPMessageChannels.ToolCallResult)
      expect(subMessage).toContain('ping')
    })
  })
})
