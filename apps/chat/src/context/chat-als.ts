import type { UIMessageStreamWriter } from 'ai'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { MyUIMessage } from '../ai/types'
import type { LanguageModelV2 } from '@ai-sdk/provider'
import type { convertMCPToolToAITool } from '../ai/tool'

export type ChatContext = {
  currentToolCallId?: string
  signal: AbortSignal
  threadId: string
  writer?: UIMessageStreamWriter<MyUIMessage>
  model: LanguageModelV2
  abort: () => void
  mcpTools: ReturnType<typeof convertMCPToolToAITool>[]
}

export const chatALS = new AsyncLocalStorage<ChatContext>()

export function useChatALS() {
  const store = chatALS.getStore()
  if (!store) {
    throw new Error('chatALS store is not available')
  }
  return store
}
