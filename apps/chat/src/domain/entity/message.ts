import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type UIMessage } from 'ai'
import assert from 'node:assert'
import pTimeout from 'p-timeout'
import type { DomainMediator } from '../mediator'
import { type DataParts, MCPToolPart } from './part'

export type UIMessageType = UIMessage<never, DataParts, never>

export class Message implements AsyncDisposable {
  #uiMessage: UIMessageType
  #mcpToolParts: MCPToolPart[]
  #mediator: DomainMediator
  #threadId: string

  readonly disposableStack = new AsyncDisposableStack()

  constructor(props: { message: UIMessageType; mediator: DomainMediator; threadId: string }) {
    const { message, mediator, threadId } = props

    this.#mediator = mediator
    this.#uiMessage = message
    this.#threadId = threadId
    this.#mcpToolParts = message.parts
      .filter((part) => part.type === 'dynamic-tool')
      .map((part) => {
        const mcpToolPart = new MCPToolPart(part)
        mcpToolPart.on('output', () => {
          mediator.emit('mcpToolOutputAvailable', mcpToolPart.uiPart)
        })
        mcpToolPart.on('error', () => {
          mediator.emit('mcpToolOutputError', mcpToolPart.uiPart)
        })
        this.disposableStack.use(mcpToolPart)
        return mcpToolPart
      })
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.disposableStack.disposeAsync()
  }

  get uiMessage() {
    return this.#uiMessage
  }

  /**
   * Resolves the result of a continuation tool call.
   * @param toolCallId - The ID of the tool call to resolve.
   * @param result - The result of the tool call.
   * @returns True if the tool call was found and resolved; otherwise, false.
   */
  resolveContinuationResult(toolCallId: string, result: CallToolResult) {
    const mcpToolPart = this.#mcpToolParts.find((part) => part.uiPart.toolCallId === toolCallId)
    if (!mcpToolPart || !mcpToolPart.isContinuation()) {
      return false
    }
    const { content, isError } = result
    const text = content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
    if (isError) {
      mcpToolPart.setError(text)
    } else {
      mcpToolPart.setOutput(text)
    }
    return true
  }

  /**
   * Marks all unfinished tool calls as continuations.
   * So that all parts are ready to be passed to model call.
   */
  markContinuation() {
    for (const mcpToolPart of this.#mcpToolParts) {
      mcpToolPart.markContinuation()
    }
  }

  async followupElicitationResult() {
    const targetParts = this.#mcpToolParts.filter((part) => part.getElicitationResult())
    if (targetParts.length === 0) {
      return
    }

    // 目前不会有工具并行调用且多个工具同时被确认的情况
    assert.equal(targetParts.length, 1)

    const part = targetParts[0]
    this.#mediator.emit('mcpToolElicitationResult', part.getElicitationResult()!)

    return pTimeout(
      new Promise<void>((resolve) => {
        this.#mediator.on('mcpToolCallResult', (result) => {
          const { id, data } = result
          if (id !== this.#threadId || data.toolCallId !== part.uiPart.toolCallId) {
            return
          }
          const text = data.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
          if (data.isError) {
            part.setError(text)
          } else {
            part.setOutput(text)
          }
          resolve()
        })
      }),
      {
        milliseconds: 60_000,
        fallback: () => {
          part.setError('Timeout')
        },
      },
    )
  }
}
