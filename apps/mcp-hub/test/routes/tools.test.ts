import type { CallToolResult, CreateMessageResult, ElicitResult, TextContent } from '@modelcontextprotocol/sdk/types.js'
import { spinUpFixtureMCPServer } from '@repo/test-utils'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey'
import { GlideClient, GlideClientConfiguration } from '@valkey/valkey-glide'
import { MCPMessageChannel } from '@th-chat/shared/types'
import { consola } from 'consola'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { testClient } from 'hono/testing'
import type { Hono } from 'hono'
import { resolve } from 'node:path'
import { inspect } from 'node:util'
import { v4 as uuid } from 'uuid'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import * as schema from '../../src/infra/db/schema'

let pgContainer: StartedPostgreSqlContainer
let valkeyContainer: StartedValkeyContainer
let db: typeof import('../../src/infra/db').db | undefined
let app: typeof import('../../src/app/routes').default
let testApp: ReturnType<typeof testClient<typeof app>>

const closeDb = async () => {
  if (!db) {
    return
  }
  const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client
  if (client) {
    await client.end()
  }
}

const REQUEST_HEADERS = { 'content-type': 'application/json' } as const

const requestListTools = ({ threadId }: { threadId: string }) =>
  testApp.api.tools.$get({
    header: {
      'mcp-thread-id': threadId,
    },
  })

const requestCallTool = ({
  threadId,
  name,
  args,
  toolCallId,
}: {
  threadId: string
  name: string
  args?: Record<string, unknown>
  toolCallId: string
}) =>
  testApp.api.tools.$post({
    header: {
      ...REQUEST_HEADERS,
      'mcp-thread-id': threadId,
    },
    json: {
      name,
      arguments: args,
      toolCallId,
    },
  })

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres').start()
  valkeyContainer = await new ValkeyContainer('valkey/valkey').start()

  vi.stubEnv('PG_CONNECTION_STRING', pgContainer.getConnectionUri())
  vi.stubEnv('TRUSTED_MCP_ORIGINS', JSON.stringify([]))
  vi.stubEnv('VALKEY_ADDRESSES', JSON.stringify([`${valkeyContainer.getHost()}:${valkeyContainer.getPort()}`]))

  db = (await import('../../src/infra/db')).db
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') })
  app = (await import('../../src/app/routes')).default
  testApp = testClient(app)

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
  await Promise.all([valkeyContainer.stop(), pgContainer.stop()])
  vi.unstubAllEnvs()
})

let cleanupMCPServer: () => void
const MCP_SERVER_PORT = 8766
const serverName = 'fixture'
const serverBaseUrl = `http://localhost:${MCP_SERVER_PORT}`

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
        [GlideClientConfiguration.PubSubChannelModes.Exact]: new Set(Object.values(MCPMessageChannel)),
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

beforeEach(async () => {
  await db!.insert(schema.mcpServerConfig).values({
    name: serverName,
    url: `${serverBaseUrl}/mcp`,
    transport: 'streamable_http',
    requestInit: null,
    userId: 'default',
    scope: 'global',
  })
})

const qualifiedName = (tool: string) => `${serverName}_${tool}`

async function fetchTools(threadId: string) {
  const res = await requestListTools({ threadId })
  expect(res.status, inspect(await res.clone().json())).toBe(200)
  return (await res.json()) as Array<{ name: string }>
}

async function expectToolAvailable(threadId: string, toolName: string) {
  const tools = await fetchTools(threadId)
  const tool = tools.find((candidate) => candidate.name === qualifiedName(toolName))
  expect(tool, `Tool ${qualifiedName(toolName)} not found`).toBeDefined()
  return tool!
}

const POLL_TIMEOUT = 10_000

let subLoggerMock: Mock
const getSubLoggerMessage = () => JSON.stringify(subLoggerMock.mock.calls)

beforeEach(() => {
  subLoggerMock = valkeySubLogger.log as unknown as Mock
})

test('list tools returns qualified tool names', async () => {
  const threadId = uuid()
  const tools = await fetchTools(threadId)
  expect(Array.isArray(tools)).toBe(true)
  expect(tools.find((tool) => tool.name === qualifiedName('echo'))).toBeDefined()
})

describe('call tools', () => {
  describe('basic tool call', () => {
    test('fixture mcp server exposes echo tool', async () => {
      const threadId = uuid()
      await expectToolAvailable(threadId, 'echo')
    })

    test('returns echo response and emits tool call result', async () => {
      const threadId = uuid()
      const toolCallId = uuid()

      const res = await requestCallTool({
        threadId,
        name: qualifiedName('echo'),
        args: { text: 'ping' },
        toolCallId,
      })
      expect(res.status, inspect(await res.clone().json())).toBe(200)
      const result = (await res.json()) as CallToolResult

      expect(result.content).toMatchObject([{ type: 'text', text: 'ping' } as TextContent])

      await expect
        .poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT })
        .toContain(MCPMessageChannel.ToolCallResult)
      await expect.poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT }).toContain(toolCallId)
      await expect.poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT }).toContain('ping')
    })
  })

  describe('sampling', () => {
    test('fixture mcp server exposes sampling tool', async () => {
      const threadId = uuid()
      await expectToolAvailable(threadId, 'sampling')
    })

    test('returns sampling result via pubsub round trip', async () => {
      const threadId = uuid()
      const toolCallId = uuid()

      const pubConn = await GlideClient.createClient({
        addresses: [{ host: valkeyContainer.getHost(), port: valkeyContainer.getPort() }],
      })
      using _disposer = {
        [Symbol.dispose]() {
          pubConn.close()
        },
      }

      const callPromise = requestCallTool({
        threadId,
        name: qualifiedName('sampling'),
        args: { prompt: 'Call to sampling tool' },
        toolCallId,
      })

      await expect
        .poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT })
        .toContain(MCPMessageChannel.SamplingRequest)
      await expect.poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT }).toContain(toolCallId)

      await pubConn.publish(
        JSON.stringify({
          id: threadId,
          data: {
            model: 'test-model',
            role: 'assistant',
            content: { type: 'text', text: 'Sampling Result' },
            toolCallId,
          } as CreateMessageResult,
        }),
        MCPMessageChannel.SamplingResult,
      )

      const response = await callPromise
      expect(response.status, inspect(await response.clone().json())).toBe(200)
      const payload = await response.json()
      expect(JSON.stringify(payload)).toContain('Sampling Result')

      await expect
        .poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT })
        .toContain(MCPMessageChannel.ToolCallResult)
      await expect.poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT }).toContain('Sampling Result')
    })
  })

  describe('elicitation', () => {
    test('fixture mcp server exposes elicitation tool', async () => {
      const threadId = uuid()
      await expectToolAvailable(threadId, 'elicitation')
    })

    const publishElicitation = async (pubConn: GlideClient, threadId: string, data: ElicitResult) => {
      await pubConn.publish(
        JSON.stringify({
          id: threadId,
          data,
        }),
        MCPMessageChannel.ElicitationResult,
      )
    }

    const startElicitation = (threadId: string, toolCallId: string) =>
      requestCallTool({
        threadId,
        name: qualifiedName('elicitation'),
        args: { topic: 'Call to elicitation tool' },
        toolCallId,
      })

    const createPublisher = async () =>
      GlideClient.createClient({
        addresses: [{ host: valkeyContainer.getHost(), port: valkeyContainer.getPort() }],
      })

    test('accept path completes successfully', async () => {
      const threadId = uuid()
      const toolCallId = uuid()
      const pubConn = await createPublisher()
      using _disposer = {
        [Symbol.dispose]() {
          pubConn.close()
        },
      }

      const callPromise = startElicitation(threadId, toolCallId)

      await expect
        .poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT })
        .toContain(MCPMessageChannel.ElicitationRequest)

      await publishElicitation(pubConn, threadId, {
        action: 'accept',
        content: {
          preferred_option: 'option_a',
          rationale: 'test',
        },
        toolCallId,
      })

      const response = await callPromise
      expect(response.status, inspect(await response.clone().json())).toBe(200)
      const payload = await response.json()
      expect(JSON.stringify(payload)).toContain('accept')
      expect(JSON.stringify(payload)).toContain('option_a')
      expect(JSON.stringify(payload)).toContain('test')

      await expect
        .poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT })
        .toContain(MCPMessageChannel.ToolCallResult)
    })

    test('decline path completes successfully', async () => {
      const threadId = uuid()
      const toolCallId = uuid()
      const pubConn = await createPublisher()
      using _disposer = {
        [Symbol.dispose]() {
          pubConn.close()
        },
      }

      const callPromise = startElicitation(threadId, toolCallId)

      await expect
        .poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT })
        .toContain(MCPMessageChannel.ElicitationRequest)

      await publishElicitation(pubConn, threadId, {
        action: 'decline',
        threadId,
        toolCallId,
      })

      const response = await callPromise
      expect(response.status, inspect(await response.clone().json())).toBe(200)
      const payload = await response.json()
      expect(JSON.stringify(payload)).toContain('decline')

      await expect
        .poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT })
        .toContain(MCPMessageChannel.ToolCallResult)
    })

    test('cancel path completes successfully', async () => {
      const threadId = uuid()
      const toolCallId = uuid()
      const pubConn = await createPublisher()
      using _disposer = {
        [Symbol.dispose]() {
          pubConn.close()
        },
      }

      const callPromise = startElicitation(threadId, toolCallId)

      await expect
        .poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT })
        .toContain(MCPMessageChannel.ElicitationRequest)

      await publishElicitation(pubConn, threadId, {
        action: 'cancel',
        threadId,
        toolCallId,
      })

      const response = await callPromise
      expect(response.status, inspect(await response.clone().json())).toBe(200)
      const payload = await response.json()
      expect(JSON.stringify(payload)).toContain('cancel')

      await expect
        .poll(getSubLoggerMessage, { interval: 100, timeout: POLL_TIMEOUT })
        .toContain(MCPMessageChannel.ToolCallResult)
    })
  })
})
