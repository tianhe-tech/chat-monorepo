import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createTestServer } from '@ai-sdk/provider-utils/test'
import { spinUpFixtureMCPServer } from '@th-chat/test-utils'
import type { Hono } from 'hono'
import consola from 'consola'
import type { UIMessage } from 'ai'
import { GlideClient } from '@valkey/valkey-glide'
import { MCPMessageChannel } from '@th-chat/shared/types'
import * as chatSchema from '../../src/infra/db/schema'
import * as mcpSchema from '../../../mcp-hub/src/infra/db/schema'
import { MCPToolPartTag } from '../../src/domain/entity/part'

type ChatDb = typeof import('../../src/infra/db').db
type McpHubDb = typeof import('../../../mcp-hub/src/infra/db').db
type CloseableDb = ChatDb | McpHubDb

vi.setConfig({ testTimeout: 120_000 })

const deepSeekServer = createTestServer({
  'https://api.deepseek.com/v1/chat/completions': {
    response: {
      type: 'stream-chunks',
      chunks: [],
    },
  },
})

const MCP_SERVER_PORT = 8766
const MCP_HUB_PORT = 9310

const jsonHeaders = { 'content-type': 'application/json' } as const

let pgContainer: StartedPostgreSqlContainer
let valkeyContainer: StartedValkeyContainer
let mcphubProcess: ChildProcessWithoutNullStreams | undefined
let mcphubClosed = false
let fixtureTeardown: (() => void) | undefined

let chatDb: ChatDb
let mcphubDb: McpHubDb
let chatApp: Hono

type SSEPayload = {
  type?: string
  toolCallId?: string
  toolName?: string
  output?: Record<string, unknown>
  messageId?: string
} & Record<string, unknown>

const buildChunk = (
  delta: Record<string, unknown>,
  options: { finishReason?: string | null; id?: string; created?: number } = {},
) => {
  const { finishReason = null, id = 'chatcmpl-tool-flow', created = Math.floor(Date.now() / 1000) } = options
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created,
    model: 'deepseek-chat',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  })}\n\n`
}

async function readSSEStream(response: Response, onEvent?: (event: SSEPayload) => Promise<void> | void) {
  const body = response.body
  if (!body) {
    throw new Error('Expected response body for SSE stream')
  }

  const decoder = new TextDecoder()
  const reader = body.getReader()
  const events: SSEPayload[] = []
  let buffer = ''
  const startedAt = Date.now()

  try {
    for (;;) {
      if (Date.now() - startedAt > 45_000) {
        throw new Error('Timed out waiting for SSE stream to finish')
      }

      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })

      let separatorIndex = buffer.indexOf('\n\n')
      while (separatorIndex !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)
        separatorIndex = buffer.indexOf('\n\n')

        if (!rawEvent.startsWith('data: ')) {
          continue
        }

        const payload = rawEvent.slice(6)
        if (payload === '[DONE]') {
          continue
        }

        const event = JSON.parse(payload) as SSEPayload
        events.push(event)
        await onEvent?.(event)
      }
    }
  } finally {
    reader.releaseLock()
  }

  return events
}

const closeDb = async (dbInstance: CloseableDb | undefined) => {
  if (!dbInstance) {
    return
  }
  const client = (dbInstance as unknown as { $client?: { end: () => Promise<void> } }).$client
  if (client) {
    await client.end()
  }
}

const waitForPortReady = async (port: number, host: string, timeoutMs = 20_000) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ port, host }, () => {
          socket.end()
          resolve()
        })
        socket.on('error', (error) => {
          socket.destroy()
          reject(error)
        })
      })
      return
    } catch {
      await delay(200)
    }
  }
  throw new Error(`Timed out waiting for ${host}:${port} to become ready`)
}

const waitForMCPHub = async (port: number, timeoutMs = 20_000) => {
  const startedAt = Date.now()
  const url = `http://127.0.0.1:${port}/api/tools`
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url, {
        headers: { 'mcp-thread-id': randomUUID() },
      })
      if (res.status >= 200 && res.status < 600) {
        return
      }
    } catch {
      // ignore until ready
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for MCP Hub HTTP endpoint at ${url}`)
}

const killProcess = async (child: ChildProcessWithoutNullStreams | undefined, signal: NodeJS.Signals = 'SIGINT') => {
  if (!child || child.killed) {
    return
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      resolve()
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill(signal)
  })
}

beforeAll(async () => {
  consola.wrapAll()
  consola.pauseLogs()

  pgContainer = await new PostgreSqlContainer('postgres').start()
  valkeyContainer = await new ValkeyContainer('valkey/valkey').start()

  const pgUri = pgContainer.getConnectionUri()
  const valkeyAddress = `${valkeyContainer.getHost()}:${valkeyContainer.getPort()}`
  const mcphubBaseUrl = `http://127.0.0.1:${MCP_HUB_PORT}`

  vi.stubEnv('PG_CONNECTION_STRING', pgUri)
  vi.stubEnv('VALKEY_ADDRESSES', JSON.stringify([valkeyAddress]))
  vi.stubEnv('ONE_API_BASE_URL', 'https://example.com/one-api')
  vi.stubEnv('ONE_API_API_KEY', 'one-api-key')
  vi.stubEnv('MCP_SERVICE_URL', `${mcphubBaseUrl}/api`)
  vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-key')
  vi.stubEnv('TRUSTED_MCP_ORIGINS', JSON.stringify([]))

  const chatDbModule = await import('../../src/infra/db')
  chatDb = chatDbModule.db
  await migrate(chatDb, {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    migrationsTable: '__drizzle_migrations_chat',
  })

  const mcphubDbModule = await import('../../../mcp-hub/src/infra/db')
  mcphubDb = mcphubDbModule.db
  await migrate(mcphubDb, {
    migrationsFolder: resolve(import.meta.dirname, '../../../mcp-hub/drizzle'),
    migrationsTable: '__drizzle_migrations_mcp_hub',
  })

  const fixture = await spinUpFixtureMCPServer({ port: MCP_SERVER_PORT })
  fixtureTeardown = fixture.teardown

  const mcphubEnv = {
    ...process.env,
    PORT: String(MCP_HUB_PORT),
    NODE_ENV: 'development',
    PG_CONNECTION_STRING: pgUri,
    TRUSTED_MCP_ORIGINS: JSON.stringify([]),
    VALKEY_ADDRESSES: JSON.stringify([valkeyAddress]),
  }

  mcphubProcess = spawn('pnpm', ['dev'], {
    cwd: resolve(import.meta.dirname, '../../../mcp-hub'),
    env: mcphubEnv,
    stdio: 'pipe',
  })

  mcphubProcess.stdout?.on('data', (chunk) => {
    // helps debugging if the process crashes unexpectedly
    process.stdout.write(chunk)
  })
  mcphubProcess.stderr?.on('data', (chunk) => {
    process.stderr.write(chunk)
  })
  mcphubProcess.once('exit', (code, signal) => {
    mcphubClosed = true
    if (code !== 0 && signal === null) {
      console.error(`MCP Hub dev process exited with code ${code ?? 'unknown'}`)
    }
  })

  await waitForPortReady(MCP_HUB_PORT, '127.0.0.1')
  await waitForMCPHub(MCP_HUB_PORT)

  const chatRouteModule = await import('../../src/app/route')
  chatApp = chatRouteModule.default
})

afterAll(async () => {
  await killProcess(mcphubProcess)
  if (!mcphubClosed) {
    await delay(500)
  }
  if (fixtureTeardown) {
    fixtureTeardown()
  }
  await closeDb(chatDb)
  await closeDb(mcphubDb)
  await Promise.allSettled([valkeyContainer.stop(), pgContainer.stop()])
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  consola.mockTypes(() => vi.fn())

  await mcphubDb.delete(mcpSchema.mcpServerConfig)
  await mcphubDb.insert(mcpSchema.mcpServerConfig).values({
    userId: 'default',
    scope: 'global',
    name: 'fixture',
    transport: 'streamable_http',
    url: `http://127.0.0.1:${MCP_SERVER_PORT}/mcp`,
    requestInit: null,
  })

  await chatDb.delete(chatSchema.message)
  await chatDb.delete(chatSchema.thread)
})

afterEach(() => {
  consola.mockTypes(() => vi.fn())
})

describe('POST /chats', () => {
  test('rejects invalid payloads', async () => {
    const res = await chatApp.request('/chats', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
  })

  test('streams assistant response and persists thread messages', async () => {
    const threadId = randomUUID()
    const userMessage: UIMessage = {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: 'hello from test' }],
    }

    deepSeekServer.urls['https://api.deepseek.com/v1/chat/completions'].response = {
      type: 'stream-chunks',
      chunks: [
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'deepseek-chat',
          choices: [{ index: 0, delta: { role: 'assistant' } }],
        })}\n\n`,
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'deepseek-chat',
          choices: [{ index: 0, delta: { content: 'Hello from DeepSeek!' } }],
        })}\n\n`,
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'deepseek-chat',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`,
        'data: [DONE]\n\n',
      ],
    }

    const response = await chatApp.request('/chats', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        threadId,
        message: userMessage,
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const body = await response.text()
    expect(body).toContain('Hello from DeepSeek!')

    const threadRows = await chatDb.query.thread.findMany()
    expect(threadRows).toHaveLength(1)
    expect(threadRows[0]?.id).toBe(threadId)

    const messageRows = await chatDb.query.message.findMany({
      orderBy: (message, { asc }) => [asc(message.createdAt)],
    })
    const roles = messageRows.map((row) => row.role)
    expect(roles).toEqual(['user', 'assistant'])
    const assistant = messageRows.find((row) => row.role === 'assistant')
    expect(JSON.stringify(assistant?.content)).toContain('Hello from DeepSeek!')
  })

  test('handles sampling tool flow', async () => {
    const threadId = randomUUID()
    const samplingToolCallId = `call_${randomUUID()}`
    const created = Math.floor(Date.now() / 1000)

    const samplingArgs = {
      __intent: 'Collect a sampling completion',
      params: {
        prompt: 'Generate a sampling snippet for integration testing.',
        temperature: 0.1,
        max_tokens: 32,
      },
    }

    deepSeekServer.urls['https://api.deepseek.com/v1/chat/completions'].response = ({ callNumber }) => {
      if (callNumber === 0) {
        return {
          type: 'stream-chunks',
          chunks: [
            buildChunk({ role: 'assistant' }, { created }),
            buildChunk(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: samplingToolCallId,
                    type: 'function',
                    function: {
                      name: 'fixture_sampling',
                      arguments: JSON.stringify(samplingArgs),
                    },
                  },
                ],
              },
              { created },
            ),
            buildChunk({}, { created, finishReason: 'tool_calls' }),
            'data: [DONE]\n\n',
          ],
        }
      }

      if (callNumber === 1) {
        return {
          type: 'stream-chunks',
          chunks: [
            buildChunk({ role: 'assistant' }, { created }),
            buildChunk({ content: 'Sampled answer from test sampling run.' }, { created }),
            buildChunk({}, { created, finishReason: 'stop' }),
            'data: [DONE]\n\n',
          ],
        }
      }

      return {
        type: 'stream-chunks',
        chunks: [
          buildChunk({ role: 'assistant' }, { created }),
          buildChunk({ content: 'All sampling steps completed.' }, { created }),
          buildChunk({}, { created, finishReason: 'stop' }),
          'data: [DONE]\n\n',
        ],
      }
    }

    const userMessage: UIMessage = {
      id: randomUUID(),
      role: 'user',
      parts: [
        {
          type: 'text',
          text: 'Please run a sampling workflow.',
        },
      ],
    }

    const response = await chatApp.request('/chats', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        threadId,
        message: userMessage,
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const events = await readSSEStream(response)

    const samplingInputEvent = events.find(
      (event) => event.type === 'tool-input-available' && event.toolCallId === samplingToolCallId,
    )
    const samplingOutputEvent = events.find(
      (event) => event.type === 'tool-output-available' && event.toolCallId === samplingToolCallId,
    )

    expect(samplingInputEvent).toBeDefined()
    expect(samplingOutputEvent).toBeDefined()
    expect(samplingOutputEvent?.output).toContain('Sampled answer from test sampling run.')
  })

  test('handles elicitation tool flow', async () => {
    const threadId = randomUUID()
    const elicitationToolCallId = `call_${randomUUID()}`
    const created = Math.floor(Date.now() / 1000)

    const elicitationArgs = {
      __intent: 'Gather preferences for integration testing',
      params: {
        topic: 'Choose between option A and B',
      },
    }

    deepSeekServer.urls['https://api.deepseek.com/v1/chat/completions'].response = ({ callNumber }) => {
      if (callNumber === 0) {
        return {
          type: 'stream-chunks',
          chunks: [
            buildChunk({ role: 'assistant' }, { created }),
            buildChunk(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: elicitationToolCallId,
                    type: 'function',
                    function: {
                      name: 'fixture_elicitation',
                      arguments: JSON.stringify(elicitationArgs),
                    },
                  },
                ],
              },
              { created },
            ),
            buildChunk({}, { created, finishReason: 'tool_calls' }),
            'data: [DONE]\n\n',
          ],
        }
      }

      return {
        type: 'stream-chunks',
        chunks: [
          buildChunk({ role: 'assistant' }, { created }),
          buildChunk({ content: 'All tool interactions completed for this test.' }, { created }),
          buildChunk({}, { created, finishReason: 'stop' }),
          'data: [DONE]\n\n',
        ],
      }
    }

    const userMessage: UIMessage = {
      id: randomUUID(),
      role: 'user',
      parts: [
        {
          type: 'text',
          text: 'Please run the elicitation workflow.',
        },
      ],
    }

    const response = await chatApp.request('/chats', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        threadId,
        message: userMessage,
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const publisher = await GlideClient.createClient({
      addresses: [
        {
          host: valkeyContainer.getHost(),
          port: valkeyContainer.getPort(),
        },
      ],
    })

    let publishedElicitationResult = false
    let sawElicitationRequest = false
    let sawElicitationResult = false

    try {
      const events = await readSSEStream(response, async (event) => {
        if (
          event.type === 'tool-output-available' &&
          event.toolCallId === elicitationToolCallId &&
          typeof event.output === 'object' &&
          event.output !== null &&
          MCPToolPartTag.elicitationRequest in (event.output as Record<string, unknown>) &&
          !publishedElicitationResult
        ) {
          sawElicitationRequest = true
          await publisher.publish(
            JSON.stringify({
              id: threadId,
              data: {
                action: 'accept',
                content: {
                  preferred_option: 'option_a',
                  rationale: 'chai all the way',
                },
                toolCallId: elicitationToolCallId,
              },
            }),
            MCPMessageChannel.ElicitationResult,
          )
          publishedElicitationResult = true
        }

        if (event.type === 'tool-output-available' && event.toolCallId === elicitationToolCallId) {
          const output = event.output as Record<string, unknown> | undefined
          if (output?.status === 'accept' && output?.choice === 'option_a') {
            sawElicitationResult = true
          }
        }
      })

      const elicitationInputEvent = events.find(
        (event) => event.type === 'tool-input-available' && event.toolCallId === elicitationToolCallId,
      )
      const elicitationOutputEvent = events.find(
        (event) => event.type === 'tool-output-available' && event.toolCallId === elicitationToolCallId,
      )

      expect(elicitationInputEvent).toBeDefined()
      expect(elicitationOutputEvent).toBeDefined()
      expect(elicitationOutputEvent?.output?.status).toBe('accept')
      expect(elicitationOutputEvent?.output?.choice).toBe('option_a')
      expect(sawElicitationRequest).toBe(true)
      expect(publishedElicitationResult).toBe(true)
      expect(sawElicitationResult).toBe(true)
    } finally {
      publisher.close()
    }
  })
})
