import type { LanguageModelV2 } from '@ai-sdk/provider'
import { ok, okAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { MyUIMessage } from '../../ai/types'
import * as dbSchema from '../../db/schema'
import { ChatsPostFlow } from './flow'

type ValuesMock = ReturnType<typeof vi.fn>
type UpdateChainMock = { set: ValuesMock; where: ValuesMock }

const threadFindFirst = vi.hoisted(() => vi.fn()) as ReturnType<typeof vi.fn>
const insertMock = vi.hoisted(() => vi.fn()) as ReturnType<typeof vi.fn>
const updateMock = vi.hoisted(() => vi.fn()) as ReturnType<typeof vi.fn>
const generateTextMock = vi.hoisted(() => vi.fn()) as ReturnType<typeof vi.fn>

const insertValuesByTable = new Map<object, ValuesMock[]>()
const updateChainsByTable = new Map<object, UpdateChainMock[]>()

vi.mock('../../../src/db', () => ({
  db: {
    query: {
      thread: {
        findFirst: threadFindFirst,
      },
    },
    insert: insertMock,
    update: updateMock,
  },
}))

vi.mock('ai', () => ({
  generateText: generateTextMock,
}))

const user = { id: 'user-1', scope: 'team' }
const threadId = 'thread-123'

const createFlow = () => new ChatsPostFlow({ threadId, user })

beforeEach(() => {
  insertValuesByTable.clear()
  updateChainsByTable.clear()

  threadFindFirst.mockReset()
  insertMock.mockReset()
  updateMock.mockReset()
  generateTextMock.mockReset()

  insertMock.mockImplementation((table: object) => {
    const valuesMock = vi.fn().mockResolvedValue(undefined)
    const existing = insertValuesByTable.get(table) ?? []
    existing.push(valuesMock)
    insertValuesByTable.set(table, existing)
    return { values: valuesMock }
  })

  updateMock.mockImplementation((table: object) => {
    const whereMock = vi.fn().mockResolvedValue(undefined)
    const setMock = vi.fn(() => ({ where: whereMock }))
    const entry: UpdateChainMock = { set: setMock, where: whereMock }
    const existing = updateChainsByTable.get(table) ?? []
    existing.push(entry)
    updateChainsByTable.set(table, existing)
    return { set: setMock }
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getPersistedMessages', () => {
  test('returns persisted messages when thread exists', async () => {
    const flow = createFlow()
    const dbMessages = [
      { id: 'msg-1', content: [{ type: 'text', text: 'hi' }], role: 'assistant' },
      { id: 'msg-2', content: [{ type: 'text', text: 'there' }], role: 'user' },
    ]

    threadFindFirst.mockResolvedValue({
      id: threadId,
      userId: user.id,
      scope: user.scope,
      messages: dbMessages,
    })

    const res = await flow.getPersistedMessages()
    expect(res.isOk()).toBe(true)
    expect(res._unsafeUnwrap()).toEqual(
      dbMessages.map((message) => ({
        id: message.id,
        parts: message.content,
        role: message.role,
      })),
    )
    expect(insertMock).not.toHaveBeenCalled()
  })

  test('inserts thread when it does not exist', async () => {
    const flow = createFlow()
    threadFindFirst.mockResolvedValue(undefined)

    const res = await flow.getPersistedMessages()
    expect(res.isOk()).toBe(true)
    expect(res._unsafeUnwrap()).toEqual([])

    expect(insertMock).toHaveBeenCalledWith(dbSchema.thread)
    const threadValues = insertValuesByTable.get(dbSchema.thread)?.at(0)
    expect(threadValues).toBeDefined()
    expect(threadValues?.mock.calls.at(0)?.at(0)).toEqual({
      id: threadId,
      userId: user.id,
      scope: user.scope,
    })
  })
})

describe('updateNewMessage', () => {
  const persisted: MyUIMessage[] = [{ id: 'msg-1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] }]

  test('appends message when it is new', async () => {
    const flow = createFlow()
    const newMessage: MyUIMessage = { id: 'msg-2', role: 'user', parts: [{ type: 'text', text: 'world' }] }

    const res = await flow.updateNewMessage({ persistedMessages: persisted, newMessage })
    expect(res.isOk()).toBe(true)
    expect(res._unsafeUnwrap()).toEqual([...persisted, newMessage])
    expect(updateMock).not.toHaveBeenCalled()
  })

  test('updates existing message when ids match', async () => {
    const flow = createFlow()
    const newMessage: MyUIMessage = { id: 'msg-1', role: 'assistant', parts: [{ type: 'text', text: 'updated' }] }

    const res = await flow.updateNewMessage({ persistedMessages: persisted, newMessage })
    expect(res.isOk()).toBe(true)
    expect(res._unsafeUnwrap()).toEqual([newMessage])

    expect(updateMock).toHaveBeenCalledWith(dbSchema.message)
    const [updateChain] = updateChainsByTable.get(dbSchema.message) ?? []
    expect(updateChain).toBeDefined()
    expect(updateChain?.set).toHaveBeenCalledWith({ content: newMessage.parts })
    expect(updateChain?.where).toHaveBeenCalledTimes(1)
  })
})

describe('persistMessages', () => {
  test('writes each ui message to the database', async () => {
    const flow = createFlow()
    const messages: MyUIMessage[] = [
      { id: 'msg-1', role: 'assistant', parts: [{ type: 'text', text: 'first' }] },
      { id: 'msg-2', role: 'user', parts: [{ type: 'text', text: 'second' }] },
    ]

    const res = await flow.persistMessages({ messages })
    expect(res.isOk()).toBe(true)

    expect(insertMock).toHaveBeenCalledTimes(messages.length)
    const messageInserts = insertValuesByTable.get(dbSchema.message)
    expect(messageInserts?.length).toBe(messages.length)
    for (const [index, valuesMock] of messageInserts?.entries() ?? []) {
      expect(valuesMock).toHaveBeenCalledWith({
        id: messages[index]!.id,
        content: messages[index]!.parts,
        threadId,
        format: 'ai_v5',
        role: messages[index]!.role,
      })
    }
  })
})

describe('setupSampling', () => {
  const toolAlpha = { isEntry: false }
  const toolEntry = { isEntry: true }
  const toolOther = {}

  test('registers handler and forwards sampling requests with filtered tools', async () => {
    const model = { modelId: 'fake-model' } as LanguageModelV2
    const controller = new AbortController()

    const mcpTools: [string, { isEntry?: boolean }][] = [
      ['server-1_alpha', toolAlpha],
      ['server-1_entry', toolEntry],
      ['server-2_beta', toolOther],
    ]

    const getToolsMock = vi.fn(() => okAsync(mcpTools))
    const sendSamplingResultMock = vi.fn().mockResolvedValue(ok(1))
    let samplingHandler: ((payload: any) => Promise<void>) | undefined

    let mcpServiceStub: any
    const onMock = vi.fn((event: string, handler: (...args: any[]) => any) => {
      if (event === 'samplingRequest') {
        samplingHandler = handler
      }
      return mcpServiceStub
    })

    mcpServiceStub = {
      getTools: getToolsMock,
      on: onMock,
      sendSamplingResult: sendSamplingResultMock,
    }

    generateTextMock.mockResolvedValue({ text: 'sampled-response' })

    const flow = createFlow()
    const setupRes = await flow.setupSampling({
      mcpService: mcpServiceStub,
      model,
      signal: controller.signal,
    })

    expect(setupRes.isOk()).toBe(true)
    expect(getToolsMock).toHaveBeenCalled()
    expect(onMock).toHaveBeenCalledWith('samplingRequest', expect.any(Function))
    expect(typeof samplingHandler).toBe('function')

    await samplingHandler?.({
      messages: [
        { role: 'user', content: { text: 'hello' } },
        { role: 'assistant', content: { text: 'reply' } },
      ],
      serverName: 'server-1',
      systemPrompt: 'system',
      includeContext: 'none',
    })

    expect(generateTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tools: {},
        abortSignal: controller.signal,
      }),
    )
    expect(sendSamplingResultMock).toHaveBeenLastCalledWith({
      model: model.modelId,
      content: { type: 'text', text: 'sampled-response' },
      role: 'assistant',
    })

    generateTextMock.mockClear()
    sendSamplingResultMock.mockClear()

    await samplingHandler?.({
      messages: [{ role: 'user', content: { text: 'second' } }],
      serverName: 'server-1',
      systemPrompt: 'system',
      includeContext: 'serverOnly',
    })

    expect(generateTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tools: { 'server-1_alpha': toolAlpha },
      }),
    )
    expect(sendSamplingResultMock).toHaveBeenCalledTimes(1)

    generateTextMock.mockClear()
    sendSamplingResultMock.mockClear()

    await samplingHandler?.({
      messages: [{ role: 'user', content: { text: 'third' } }],
      serverName: 'server-1',
      systemPrompt: 'system',
      includeContext: 'allServers',
    })

    expect(generateTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tools: {
          'server-1_alpha': toolAlpha,
          'server-1_entry': toolEntry,
          'server-2_beta': toolOther,
        },
      }),
    )
    expect(sendSamplingResultMock).toHaveBeenCalledTimes(1)
  })
})
