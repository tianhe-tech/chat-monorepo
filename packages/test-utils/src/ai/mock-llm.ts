import type {
  LanguageModelV2Content,
  LanguageModelV2Prompt,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from '@ai-sdk/provider'
import { MockLanguageModelV2 } from 'ai/test'

type MockLLMTool = {
  name: string
  input?: Record<string, unknown>
  getOutput: () => Promise<unknown>
}

const createUsage = (): LanguageModelV2Usage => ({
  inputTokens: undefined,
  outputTokens: undefined,
  totalTokens: undefined,
})

const ensureRequiredTools = (availableTools: readonly { name: string }[] | undefined, requiredTools: MockLLMTool[]) => {
  const providedToolNames = new Set((availableTools ?? []).map((tool) => tool.name))
  const missingTools = requiredTools.map((tool) => tool.name).filter((name) => !providedToolNames.has(name))

  if (missingTools.length > 0) {
    throw new Error(`Missing required tool(s): ${missingTools.join(', ')}`)
  }
}

const stringifyPrompt = (prompt: LanguageModelV2Prompt): string => {
  const fragments: string[] = []

  for (const message of prompt) {
    switch (message.role) {
      case 'system':
        fragments.push(message.content)
        break
      case 'user':
      case 'assistant':
        for (const part of message.content) {
          if (part.type === 'text' || part.type === 'reasoning') {
            fragments.push(part.text)
          } else if (part.type === 'tool-call' || part.type === 'tool-result') {
            fragments.push(`${part.type}:${part.toolName}`)
          } else if (part.type === 'file') {
            fragments.push(`[file:${part.mediaType}]`)
          }
        }
        break
      case 'tool':
        for (const part of message.content) {
          fragments.push(`tool-result:${part.toolName}`)
        }
        break
      default:
    }
  }

  if (fragments.length === 0) {
    return JSON.stringify(prompt)
  }

  return fragments.join('\n')
}

const buildContentSequence = async (
  prompt: LanguageModelV2Prompt,
  requiredTools: MockLLMTool[],
): Promise<{ content: LanguageModelV2Content[]; usage: LanguageModelV2Usage }> => {
  const content: LanguageModelV2Content[] = []
  content.push({ type: 'text', text: stringifyPrompt(prompt) })

  for (const [index, tool] of requiredTools.entries()) {
    const toolCallId = `${tool.name}-${index}`
    const serializedInput = JSON.stringify(tool.input ?? {})

    content.push({ type: 'text', text: `calling tool ${tool.name}` })
    content.push({
      type: 'tool-call',
      toolCallId,
      toolName: tool.name,
      input: serializedInput,
      providerExecuted: false,
    })

    const result = await tool.getOutput()

    content.push({
      type: 'tool-result',
      toolCallId,
      toolName: tool.name,
      result,
      providerExecuted: false,
    })
  }

  return { content, usage: createUsage() }
}

const convertContentToStreamParts = (
  content: LanguageModelV2Content[],
  usage: LanguageModelV2Usage,
): LanguageModelV2StreamPart[] => {
  const parts: LanguageModelV2StreamPart[] = [{ type: 'stream-start', warnings: [] }]
  let textIndex = 0

  for (const item of content) {
    if (item.type === 'text') {
      const id = `text-${textIndex++}`
      parts.push({ type: 'text-start', id })

      if (item.text.length > 0) {
        parts.push({ type: 'text-delta', id, delta: item.text })
      }

      parts.push({ type: 'text-end', id })
      continue
    }

    if (item.type === 'tool-call' || item.type === 'tool-result') {
      parts.push(item)
      continue
    }

    // Exhaustiveness helper so we notice new content types.
    throw new Error(`Unsupported content type for streaming: ${item.type}`)
  }

  parts.push({ type: 'finish', usage, finishReason: 'stop' })

  return parts
}

export const createMockLLM = (requiredTools: MockLLMTool[]) =>
  new MockLanguageModelV2({
    modelId: 'mock-model',
    doGenerate: async ({ prompt, tools }) => {
      ensureRequiredTools(tools, requiredTools)

      const { content, usage } = await buildContentSequence(prompt, requiredTools)

      return {
        content,
        finishReason: 'stop',
        usage,
        warnings: [],
      }
    },
    doStream: async ({ prompt, tools }) => {
      ensureRequiredTools(tools, requiredTools)

      const { content, usage } = await buildContentSequence(prompt, requiredTools)
      const streamParts = convertContentToStreamParts(content, usage)

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        start(controller) {
          try {
            for (const part of streamParts) {
              controller.enqueue(part)
            }
            controller.close()
          } catch (error) {
            controller.error(error)
          }
        },
      })

      return { stream }
    },
  })
