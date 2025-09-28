import {
  type CallToolResult,
  type CreateMessageResult,
  type ElicitResult,
  type TextContent,
} from '@modelcontextprotocol/sdk/types.js'
import { spinUpFixtureMCPServer } from '@repo/test-utils'
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
import { testClient } from 'hono/testing'
import type honoApp from '../../src/routes'

let pgContainer: StartedPostgreSqlContainer
let valkeyContainer: StartedValkeyContainer
let db: typeof import('../../src/db').db
let testApp: ReturnType<typeof testClient<typeof honoApp>>

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres').start()
  valkeyContainer = await new ValkeyContainer('valkey/valkey').start()

  vi.stubEnv('PG_CONNECTION_STRING', pgContainer.getConnectionUri())
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
  return testApp.tools.$get(
    {
      query: {
        refresh: String(refresh),
      },
    },
    {
      headers: {
        'mcp-thread-id': threadId,
      },
    },
  )
}

function requestCallTool({ threadId, name, args }: { threadId: string; name: string; args?: Record<string, unknown> }) {
  return testApp.tools.$post(
    {
      json: {
        name,
        arguments: args,
      },
    },
    {
      headers: {
        'mcp-thread-id': threadId,
      },
    },
  )
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
  async function fetchServerTools(threadId: string) {
    const listRes = await requestListTools({ threadId, refresh: true })
    expect(listRes.status).toBe(200)
    const toolMap = (await listRes.json()) as Record<string, Array<{ name: string }>>
    expect(toolMap).toHaveProperty(serverName)
    const serverTools = toolMap[serverName]
    expect(Array.isArray(serverTools)).toBe(true)
    return serverTools
  }

  async function expectToolAvailable(threadId: string, toolName: string) {
    const serverTools = await fetchServerTools(threadId)
    const tool = serverTools.find((candidate) => candidate.name === toolName)
    expect(tool).toBeDefined()
    return tool
  }

  let subLoggerMock: Mock
  const getSubLoggerMessage = () => JSON.stringify(subLoggerMock.mock.calls)
  beforeEach(() => {
    subLoggerMock = valkeySubLogger.log as unknown as Mock
  })

  describe('basic tool call', () => {
    test('fixture mcp server has echo tool', async () => {
      const threadId = uuid()
      await expectToolAvailable(threadId, 'echo')
    })

    test('returns echo response', async () => {
      const threadId = uuid()

      const callRes = await requestCallTool({
        threadId,
        name: `${serverName}_echo`,
        args: { text: 'ping' },
      })
      expect(callRes.status).toBe(200)
      const res = (await callRes.json()) as CallToolResult

      expect(res.content).toMatchObject([{ type: 'text', text: 'ping' } as TextContent])

      await expect.poll(() => subLoggerMock, { interval: 100, timeout: 1000 }).toHaveBeenCalledOnce()
      const subMessage = getSubLoggerMessage()
      expect(subMessage).toContain(MCPMessageChannels.ToolCallResult)
      expect(subMessage).toContain('ping')
    })
  })

  describe('sampling', () => {
    test('fixture mcp server has sampling tool', async () => {
      const threadId = uuid()
      await expectToolAvailable(threadId, 'sampling')
    })

    test('returns sampling result', async () => {
      const threadId = uuid()

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
        name: `${serverName}_sampling`,
        args: { prompt: 'Call to sampling tool' },
      })

      await expect.poll(() => subLoggerMock, { interval: 100, timeout: 5000 }).toHaveBeenCalledOnce()
      const samplingMessage = getSubLoggerMessage()
      expect(samplingMessage).toContain(MCPMessageChannels.SamplingRequest)
      expect(samplingMessage).toContain('Call to sampling tool')

      await pubConn.publish(
        JSON.stringify({
          model: 'test-model',
          role: 'assistant',
          content: { type: 'text', text: 'Sampling Result' },
          threadId,
        } as CreateMessageResult),
        MCPMessageChannels.SamplingResult,
      )

      await expect.poll(() => subLoggerMock, { interval: 100, timeout: 1000 }).toHaveBeenCalledTimes(3)

      const res = await callPromise
      expect(JSON.stringify(await res.json())).toContain('Sampling Result')

      const toolCallMessage = getSubLoggerMessage()
      expect(toolCallMessage).toContain(MCPMessageChannels.ToolCallResult)
      expect(toolCallMessage).toContain('Sampling Result')
    })
  })

  describe('elicitation', () => {
    test('fixture mcp server has elicitation tool', async () => {
      const threadId = uuid()

      expectToolAvailable(threadId, 'elicitation')
    })

    test('accept', async () => {
      const threadId = uuid()

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
        name: `${serverName}_elicitation`,
        args: { topic: 'Call to elicitation tool' },
      })

      await expect.poll(() => subLoggerMock, { interval: 100, timeout: 1000 }).toHaveBeenCalledOnce()
      const elicitationMessage = getSubLoggerMessage()
      expect(elicitationMessage).toContain(MCPMessageChannels.ElicitationRequest)
      expect(elicitationMessage).toContain('Call to elicitation tool')

      await pubConn.publish(
        JSON.stringify({
          action: 'accept',
          threadId,
          content: {
            preferred_option: 'option_a',
            rationale: 'test',
          },
        } as ElicitResult),
        MCPMessageChannels.ElicitationResult,
      )

      await expect.poll(() => subLoggerMock, { interval: 100, timeout: 1000 }).toHaveBeenCalledTimes(3)

      const res = await (await callPromise).json()
      expect(JSON.stringify(res)).toContain('accept')
      expect(JSON.stringify(res)).toContain('option_a')
      expect(JSON.stringify(res)).toContain('test')

      const toolCallMessage = getSubLoggerMessage()
      expect(toolCallMessage).toContain(MCPMessageChannels.ToolCallResult)
      expect(toolCallMessage).toContain('accept')
      expect(toolCallMessage).toContain('option_a')
      expect(toolCallMessage).toContain('test')
    })

    test('decline', async () => {
      const threadId = uuid()

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
        name: `${serverName}_elicitation`,
        args: { topic: 'Call to elicitation tool' },
      })

      await expect.poll(() => subLoggerMock, { interval: 100, timeout: 1000 }).toHaveBeenCalledOnce()
      const elicitationMessage = getSubLoggerMessage()
      expect(elicitationMessage).toContain(MCPMessageChannels.ElicitationRequest)
      expect(elicitationMessage).toContain('Call to elicitation tool')

      await pubConn.publish(
        JSON.stringify({
          action: 'decline',
          threadId,
        } as ElicitResult),
        MCPMessageChannels.ElicitationResult,
      )

      await expect.poll(() => subLoggerMock, { interval: 100, timeout: 1000 }).toHaveBeenCalledTimes(3)

      const res = await (await callPromise).json()
      expect(JSON.stringify(res)).toContain('decline')

      const toolCallMessage = getSubLoggerMessage()
      expect(toolCallMessage).toContain(MCPMessageChannels.ToolCallResult)
      expect(toolCallMessage).toContain('decline')
    })

    test('cancel', async () => {
      const threadId = uuid()

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
        name: `${serverName}_elicitation`,
        args: { topic: 'Call to elicitation tool' },
      })

      await expect.poll(() => subLoggerMock, { interval: 100, timeout: 1000 }).toHaveBeenCalledOnce()
      const elicitationMessage = getSubLoggerMessage()
      expect(elicitationMessage).toContain(MCPMessageChannels.ElicitationRequest)
      expect(elicitationMessage).toContain('Call to elicitation tool')

      await pubConn.publish(
        JSON.stringify({
          action: 'cancel',
          threadId,
        } as ElicitResult),
        MCPMessageChannels.ElicitationResult,
      )

      await expect.poll(() => subLoggerMock, { interval: 100, timeout: 1000 }).toHaveBeenCalledTimes(3)

      const res = await (await callPromise).json()
      expect(JSON.stringify(res)).toContain('cancel')

      const toolCallMessage = getSubLoggerMessage()
      expect(toolCallMessage).toContain(MCPMessageChannels.ToolCallResult)
      expect(toolCallMessage).toContain('cancel')
    })
  })
})
