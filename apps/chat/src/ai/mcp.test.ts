import { describe, expect, it, beforeEach, vi } from 'vitest'
import { MCPMessageChannel, UIPartBrands } from '@repo/shared/types'
import { ChatMCPService } from './mcp'

const { kyCreateMock, dynamicToolMock, jsonSchemaMock } = vi.hoisted(() => {
  return {
    kyCreateMock: vi.fn(),
    dynamicToolMock: vi.fn((config) => config),
    jsonSchemaMock: vi.fn((schema) => schema),
  }
})

vi.mock('ky', () => ({
  default: {
    create: kyCreateMock,
  },
}))

vi.mock('ai', () => ({
  dynamicTool: dynamicToolMock,
  jsonSchema: jsonSchemaMock,
}))

vi.mock('consola', () => {
  const createLogger = () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      withTag: vi.fn(() => createLogger()),
    }
    return logger
  }

  const logger = createLogger()
  return {
    consola: logger,
    default: logger,
  }
})

vi.mock('consola/utils', () => ({
  colorize: (_color: string, text: string) => text,
}))

vi.mock('../env', () => ({
  env: {
    MCP_SERVICE_URL: 'http://localhost:4000',
  },
}))

const createChatMCPService = (overrides?: { threadId?: string }) => {
  const postMock = vi.fn()
  const getMock = vi.fn()

  kyCreateMock.mockReturnValueOnce({
    post: postMock,
    get: getMock,
  })

  const publishMock = vi.fn().mockResolvedValue(1)
  const closeMock = vi.fn()
  const writer = { write: vi.fn() }
  const abort = vi.fn()
  const controller = new AbortController()

  const service = new (ChatMCPService as any)({
    threadId: overrides?.threadId ?? 'thread-123',
    signal: controller.signal,
    pubsub: {
      publish: publishMock,
      close: closeMock,
    },
    writer,
    abort,
  }) as ChatMCPService

  return {
    service,
    postMock,
    getMock,
    publishMock,
    closeMock,
    writer,
    abort,
    signal: controller.signal,
    threadId: overrides?.threadId ?? 'thread-123',
  }
}

describe('ChatMCPService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    kyCreateMock?.mockReset()
    dynamicToolMock?.mockReset()
    jsonSchemaMock?.mockReset()
  })

  describe('callTool', () => {
    it('returns text content when the MCP call succeeds', async () => {
      const { service, postMock, threadId } = createChatMCPService()

      const jsonMock = vi.fn().mockResolvedValue({
        content: [
          { type: 'text', text: 'First' },
          { type: 'text', text: 'Second' },
        ],
        isError: false,
      })
      postMock.mockReturnValue({ json: jsonMock })

      const result = await service.callTool({ name: 'test', arguments: { foo: 'bar' }, _meta: {} }).unwrapOr([])

      expect(postMock).toHaveBeenCalledWith(
        'tools',
        expect.objectContaining({
          json: { name: 'test', arguments: { foo: 'bar' }, _meta: {} },
          headers: { 'mcp-thread-id': threadId },
        }),
      )
      expect(result).toEqual(['First', 'Second'])
    })

    it('surfaces an error when the MCP call indicates failure', async () => {
      const { service, postMock } = createChatMCPService()
      const jsonMock = vi.fn().mockResolvedValue({
        content: [],
        isError: true,
      })
      postMock.mockReturnValue({ json: jsonMock })

      const outcome = await service.callTool({ name: 'broken', arguments: {}, _meta: {} }).match(
        () => 'ok',
        (error) => error,
      )

      expect(outcome).toBeInstanceOf(Error)
      expect((outcome as Error).message).toBe('MCP Tool broken execution failed:')
    })

    it('fails when non-text content is returned', async () => {
      const { service, postMock } = createChatMCPService()
      const jsonMock = vi.fn().mockResolvedValue({
        content: [{ type: 'image', text: 'ignored' }],
        isError: false,
      })
      postMock.mockReturnValue({ json: jsonMock })

      const outcome = await service.callTool({ name: 'non-text', arguments: {}, _meta: {} }).match(
        () => 'ok',
        (error) => error,
      )

      expect(outcome).toBeInstanceOf(Error)
      expect((outcome as Error).message).toBe('Unexpected content type: image')
    })
  })

  describe('getTools', () => {
    it('fetches and converts MCP tools once and calls tool execution through callTool', async () => {
      const { service, getMock, postMock } = createChatMCPService()

      const getJson = vi.fn().mockResolvedValue({
        serverA: [
          {
            name: 'tool-one',
            description: 'Example tool',
            inputSchema: { type: 'object' },
            _meta: { isEntry: true },
          },
        ],
      })
      getMock.mockReturnValue({ json: getJson })

      postMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Result' }],
          isError: false,
        }),
      })

      const tools = await service.getTools().unwrapOr([])
      expect(getMock).toHaveBeenCalledTimes(1)
      expect(jsonSchemaMock).toHaveBeenCalledWith({ type: 'object' })
      expect(dynamicToolMock).toHaveBeenCalledTimes(1)
      expect(tools).toHaveLength(1)

      const [toolName, tool] = tools[0]
      expect(toolName).toBe('serverA_tool-one')
      expect(tool.isEntry).toBe(true)

      const executeResult = await tool.execute?.({ sample: true }, { toolCallId: 'call-42', messages: [] })
      expect(executeResult).toEqual(['Result'])

      const [lastPath, lastOptions] = postMock.mock.calls.at(-1) ?? []
      expect(lastPath).toBe('tools')
      expect(lastOptions).toMatchObject({
        json: {
          name: 'serverA_tool-one',
          arguments: { sample: true },
          _meta: { progressToken: 'call-42' },
        },
      })

      await service.getTools().unwrapOr([])
      expect(getMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('fulfillToolElicitation', () => {
    it('publishes confirmation and resolves with tool output when the result matches', async () => {
      const { service, publishMock, writer } = createChatMCPService()

      const part = {
        type: 'dynamic-tool',
        state: 'output-available',
        toolCallId: 'call-1',
        toolName: 'sample-tool',
        input: { _confirm: 'confirm' },
        output: {
          [UIPartBrands.ElicitationResponse]: { action: 'confirm' },
        },
      } as const

      const promise = service.fulfillToolElicitation(part as any)

      expect(publishMock).toHaveBeenCalledTimes(1)

      const [{ channel, message }] = publishMock.mock.calls[0] as [{ channel: string; message: string }]
      expect(channel).toBe(MCPMessageChannel.ElicitationResult)
      expect(JSON.parse(message)).toEqual({ data: { action: 'confirm' }, id: 'thread-123' })

      await publishMock.mock.results[0]?.value
      await new Promise((resolve) => setTimeout(resolve, 0))

      service.emit('toolCallResult', {
        content: [
          { type: 'text', text: 'Line 1' },
          { type: 'text', text: 'Line 2' },
        ],
        isError: false,
        progressToken: 'call-1',
      })

      const result = await promise
      expect(result.state).toBe('output-available')
      expect(result.output).toBe('Line 1\nLine 2')
      expect(writer.write).not.toHaveBeenCalled()
    })

    it('emits an output error when the result belongs to a different tool call', async () => {
      const { service, publishMock, writer } = createChatMCPService()

      const part = {
        type: 'dynamic-tool',
        state: 'output-available',
        toolCallId: 'call-1',
        toolName: 'sample-tool',
        input: { _confirm: 'confirm' },
        output: {
          [UIPartBrands.ElicitationResponse]: { action: 'confirm' },
        },
      } as const

      const promise = service.fulfillToolElicitation(part as any)

      expect(publishMock).toHaveBeenCalledTimes(1)

      const [{ channel, message }] = publishMock.mock.calls[0] as [{ channel: string; message: string }]
      expect(channel).toBe(MCPMessageChannel.ElicitationResult)
      expect(JSON.parse(message)).toEqual({ data: { action: 'confirm' }, id: 'thread-123' })

      await publishMock.mock.results[0]?.value
      await new Promise((resolve) => setTimeout(resolve, 0))

      service.emit('toolCallResult', {
        content: [{ type: 'text', text: 'Ignored' }],
        isError: false,
        progressToken: 'call-2',
      })

      const result = await promise
      expect(result.state).toBe('output-error')
      expect(result.errorText).toBe('Internal Tool state error')
      expect(writer.write).toHaveBeenCalledWith({
        type: 'tool-output-error',
        toolCallId: 'call-1',
        dynamic: true,
        errorText: 'Internal Tool state error',
      })
    })
  })
})
