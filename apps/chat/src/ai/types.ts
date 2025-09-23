import type { DataUIParts, Tools } from '@repo/shared/ai'
import type { UIMessage, UIMessageStreamWriter } from 'ai'

export type MyUIMessage = UIMessage<never, DataUIParts, Tools>
export type MyUIPart = MyUIMessage['parts'][number]

export type AIStreamContext = {
  writer?: UIMessageStreamWriter<MyUIMessage>
  abort?: () => void
}
