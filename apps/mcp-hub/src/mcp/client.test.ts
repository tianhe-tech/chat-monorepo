import type { MCPServerDefinition } from '@internal/shared/types'
import { spinUpFixtureMCPServer } from '@repo/test-utils'
import { consola } from 'consola'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { InternalMCPClient, MCPClientManager } from './client'

let cleanupMCPServer: (() => void) | undefined
const MCP_SERVER_PORT = 8765

beforeAll(async () => {
  consola.wrapAll()
  consola.pauseLogs()

  const { teardown } = await spinUpFixtureMCPServer({ port: MCP_SERVER_PORT })
  cleanupMCPServer = teardown
})

afterAll(() => {
  cleanupMCPServer?.()
})

describe('InternalMCPClient', () => {
  const createClient = (options: { onProgress?: () => void; server?: MCPServerDefinition; timeout?: number } = {}) => {
    const { onProgress, timeout, server = { url: `http://localhost:${MCP_SERVER_PORT}/mcp` } } = options

    return new InternalMCPClient({
      name: 'test',
      server,
      onProgress,
      timeout,
    })
  }

  test('connects', async () => {
    await using client = createClient()
    const res = await client.connect()
    expect(res.unwrapOr(false)).toBe(true)
  })

  test('errors on invalid target', async () => {
    await using client = createClient({ server: { url: 'http://example.com' } })
    const res = await client.connect()
    expect(res.isErr()).toBe(true)
  })

  test('respects timeout setting', async () => {
    await using client = createClient({ timeout: 1 })
    await client.connect()
    const res = await client.listTools()
    expect(res.isErr()).toBe(true)
  })

  test('lists available tools from the server', async () => {
    await using client = createClient()
    const res = await client.listTools()
    expect(res.isOk()).toBe(true)
    const tools = res._unsafeUnwrap()
    const toolNames = tools.map((tool) => tool.name)
    expect(toolNames).toContain('echo')
  })

  test('calls tools via MCP transport', async () => {
    await using client = createClient()
    const res = await client.callTool({ name: 'echo', arguments: { text: 'ping' } })
    expect(res.isOk()).toBe(true)
    const callResult = res._unsafeUnwrap()
    expect(callResult.content).toMatchObject([{ type: 'text', text: 'ping' }])
  })
})

describe('MCPClientManager', () => {
  const serverName = 'fixture'
  const server = { url: `http://localhost:${MCP_SERVER_PORT}/mcp` }

  const createManager = async () => {
    const manager = new MCPClientManager({
      servers: { [serverName]: server },
    })
    return manager
  }

  test('constructs and destructs tool names', async () => {
    await using manager = await createManager()
    const fullName = manager.constructToolName({ serverName, toolName: 'echo' })
    expect(fullName).toBe(`${serverName}_echo`)
    expect(manager.destructToolName(fullName)).toEqual({ serverName, toolName: 'echo' })
    expect(() => manager.destructToolName('invalid')).toThrowError(/Invalid tool name/)
  })

  test('lists tools across configured servers', async () => {
    await using manager = await createManager()
    const res = await manager.listTools()
    expect(res.isOk()).toBe(true)
    const toolsByServer = res._unsafeUnwrap()
    expect(toolsByServer).toHaveProperty(serverName)
    const toolNames = toolsByServer[serverName].map((tool) => tool.name)
    expect(toolNames).toContain('echo')
  })

  test('delegates tool invocation to the correct server', async () => {
    await using manager = await createManager()
    const fullName = manager.constructToolName({ serverName, toolName: 'echo' })
    const res = await manager.callTool({ name: fullName, arguments: { text: 'pong' } })
    expect(res.isOk()).toBe(true)
    const callResult = res._unsafeUnwrap()
    expect(callResult.content).toMatchObject([{ type: 'text', text: 'pong' }])
  })
})
