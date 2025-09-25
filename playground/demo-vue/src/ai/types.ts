import type { UIMessage } from 'ai'
import type { DataUIParts, Tools } from '@repo/shared/ai'

export type MyUIMessage = UIMessage<never, DataUIParts, Tools>
