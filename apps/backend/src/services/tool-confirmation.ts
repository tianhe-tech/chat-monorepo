interface ToolConfirmationContext {
  toolName: string
  execute: (input: unknown) => Promise<unknown>
}

export class ToolConfirmationService {
  private toolsNeedingConfirmation = new Map<string, ToolConfirmationContext>()

  register({ toolName, execute }: ToolConfirmationContext) {
    this.toolsNeedingConfirmation.set(toolName, { toolName, execute })
    return this
  }

  unregister(toolName: string) {
    return this.toolsNeedingConfirmation.delete(toolName)
  }

  check(toolName: string) {
    return this.toolsNeedingConfirmation.has(toolName)
  }

  get(toolName: string) {
    return this.toolsNeedingConfirmation.get(toolName)
  }
}
