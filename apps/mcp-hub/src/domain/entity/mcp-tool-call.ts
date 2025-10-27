import { err, ok, type Result } from 'neverthrow'

type States = 'running' | 'result' | 'pendingElicitation' | 'pendingSampling'

export class MCPToolCallStateError extends Error {}

export class MCPToolCall {
  readonly id: string
  readonly name: string
  #state: States = 'running'

  constructor(id: string, name: string) {
    this.id = id
    this.name = name
  }

  result(): Result<void, MCPToolCallStateError> {
    if (this.#state !== 'running') {
      return err(new MCPToolCallStateError())
    }
    this.#state = 'result'
    return ok()
  }

  elicitationRequest(): Result<void, MCPToolCallStateError> {
    if (this.#state !== 'running') {
      return err(new MCPToolCallStateError())
    }
    this.#state = 'pendingElicitation'
    return ok()
  }

  elicitationResult(): Result<void, MCPToolCallStateError> {
    if (this.#state !== 'pendingElicitation') {
      return err(new MCPToolCallStateError())
    }
    this.#state = 'running'
    return ok()
  }

  samplingRequest(): Result<void, MCPToolCallStateError> {
    if (this.#state !== 'running') {
      return err(new MCPToolCallStateError())
    }
    this.#state = 'pendingSampling'
    return ok()
  }

  samplingResult(): Result<void, MCPToolCallStateError> {
    if (this.#state !== 'pendingSampling') {
      return err(new MCPToolCallStateError())
    }
    this.#state = 'running'
    return ok()
  }
}
