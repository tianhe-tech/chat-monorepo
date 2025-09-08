import type { UIMessage } from 'ai'
import type { DataUIParts, Tools } from '@th-chat/shared'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.d.ts'

export type MyUIMessage = UIMessage<never, DataUIParts, Tools>
