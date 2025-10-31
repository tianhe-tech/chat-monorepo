import {
  ElicitRequestSchema,
  ElicitResultSchema,
  type ElicitRequest,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { DynamicToolUIPart } from 'ai'
import EventEmitter from 'node:events'
import z from 'zod'
import * as Contract from '@th-chat/shared/contracts/chat-mcp-hub'

export const progressPartSchema = z.object({
  progress: z.number().positive(),
  total: z.number().positive().optional(),
  message: z.string().optional(),
})
export type ProgressPart = z.infer<typeof progressPartSchema>

export type DataParts = {
  progress: ProgressPart
}

export const MCPToolPartTag = {
  elicitationRequest: '__elicitation_request',
  elicitationResult: '__elicitation_result',
  continuation: '__continuation',
  intent: '__intent',
} as const

export class MCPToolPart
  extends EventEmitter<{
    output: []
    error: []
  }>
  implements Disposable
{
  #uiPart: DynamicToolUIPart

  constructor(part: DynamicToolUIPart) {
    super()
    this.#uiPart = part
  }

  [Symbol.dispose](): void {
    this.removeAllListeners()
  }

  get uiPart() {
    return this.#uiPart
  }

  isContinuation(): boolean {
    if (this.#uiPart.state !== 'output-available') {
      return false
    }
    const output = this.#uiPart.output
    return (
      typeof output === 'object' &&
      output !== null &&
      MCPToolPartTag.continuation in output &&
      output[MCPToolPartTag.continuation] === true
    )
  }

  getElicitationRequest(): Contract.ElicitationRequest | undefined {
    if (this.#uiPart.state !== 'output-available') {
      return undefined
    }
    const output = this.#uiPart.output
    if (typeof output !== 'object' || output === null || !(MCPToolPartTag.elicitationRequest in output)) {
      return undefined
    }
    const { success, data } = Contract.elicitationRequestSchema.safeParse(output[MCPToolPartTag.elicitationRequest])
    if (!success) {
      return undefined
    }
    return data
  }

  getElicitationResult(): Contract.ElicitationResult | undefined {
    if (this.#uiPart.state !== 'output-available') {
      return undefined
    }
    const output = this.#uiPart.output
    if (typeof output !== 'object' || output === null || !(MCPToolPartTag.elicitationResult in output)) {
      return undefined
    }
    const { success, data } = Contract.elicitationResultSchema.safeParse(output[MCPToolPartTag.elicitationResult])
    if (!success) {
      return undefined
    }
    return data
  }

  getIntent(): string | undefined {
    if (this.#uiPart.state !== 'output-available') {
      return undefined
    }
    const output = this.#uiPart.output
    if (typeof output !== 'object' || output === null || !(MCPToolPartTag.intent in output)) {
      return undefined
    }
    const intent = output[MCPToolPartTag.intent]
    if (typeof intent !== 'string') {
      return undefined
    }
    return intent
  }

  markContinuation() {
    if (this.#uiPart.state.startsWith('output')) {
      return
    }
    this.#uiPart.state = 'output-available'
    this.#uiPart.errorText = undefined
    this.#uiPart.output = {
      [MCPToolPartTag.continuation]: true,
    }
  }

  setError(errorText: string) {
    this.#uiPart.state = 'output-error'
    this.#uiPart.errorText = errorText
    this.#uiPart.output = undefined
    this.emit('error')
  }

  setOutput(output: unknown) {
    this.#uiPart.state = 'output-available'
    this.#uiPart.errorText = undefined
    this.#uiPart.output = output
    this.emit('output')
  }
}
