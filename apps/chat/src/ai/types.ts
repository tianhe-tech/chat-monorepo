import type { DataUIParts, Tools } from '@internal/shared/ai'
import type { UIMessage, UIMessageStreamWriter } from 'ai'

export type MyUIMessage = UIMessage<never, DataUIParts, Tools>
export type MyUIPart = MyUIMessage['parts'][number]
