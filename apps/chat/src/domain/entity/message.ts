import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type UIMessage } from 'ai'
import type { DomainMediator } from '../mediator'
import { type DataParts, MCPToolPart } from './part'
import { ResultAsync } from 'neverthrow'
import assert from 'node:assert'

export type UIMessageType = UIMessage<never, DataParts, never>

export class Message implements AsyncDisposable {
  #uiMessage: UIMessageType
  #mcpToolParts: MCPToolPart[]

  readonly disposableStack = new AsyncDisposableStack()

  constructor(props: { message: UIMessageType; mediator: DomainMediator }) {
    const { message, mediator } = props

    this.#uiMessage = message
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

  followupElicitationResult() {
    const targetParts = this.#mcpToolParts.filter((part) => part.getElicitationResult())

    // 目前不会有工具并行调用且多个工具同时被确认的情况
    assert.equal(targetParts.length, 1)

    const part = targetParts[0]
  }
}
