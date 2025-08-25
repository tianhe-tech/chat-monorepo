import type { UIMessage } from 'ai'

export type DataThreadTitleUIPart = {
  title: string
}

export type DataUIParts = {
  'thread-title': DataThreadTitleUIPart
}

export type MyUIMessage = UIMessage<never, DataUIParts>
