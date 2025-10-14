import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

//#region data ui part
export const threadTitleDataSchema = z.object({ title: z.string() })
export const progressDataSchema = z.object({
  progress: z.number().positive(),
  total: z.number().positive().optional(),
  message: z.string().optional(),
})
export const abortedToolDataSchema = z.object({
  toolCallId: z.string(),
  toolType: z.enum(['builtin', 'mcp']),
  abortReason: z.enum(['intercept', 'elicit']),
})

export type ThreadTitleDataPart = z.infer<typeof threadTitleDataSchema>
export type ProgressDataPart = z.infer<typeof progressDataSchema>
export type AbortedToolDataPart = z.infer<typeof abortedToolDataSchema>

export type DataUIParts = {
  'thread-title': ThreadTitleDataPart
  progress: ProgressDataPart
  'aborted-tool': AbortedToolDataPart
}
//#endregion

export const UIPartBrands = {
  ElicitationRequest: '__elicitation_request',
  ElicitationResponse: '__elicitation_response',
} as const

export function isElicitationRequest(val: unknown): val is { [UIPartBrands.ElicitationRequest]: ElicitRequest } {
  return typeof val === 'object' && val !== null && UIPartBrands.ElicitationRequest in val
}

export function isElicitationResponse(val: unknown): val is { [UIPartBrands.ElicitationResponse]: ElicitResult } {
  return typeof val === 'object' && val !== null && UIPartBrands.ElicitationResponse in val
}

