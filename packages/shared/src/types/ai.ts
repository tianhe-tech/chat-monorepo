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

export type DataUIParts = {
  'thread-title': ThreadTitleDataPart
  progress: ProgressDataPart
}
//#endregion

export const UIPartTag = {
  IsElicitationRequest: '__elicitation_request',
  IsElicitationResponse: '__elicitation_response',
  IsContinuation: '__continuation',
  ToolCallIntent: '__tool_call_intent',
} as const

/**
 * Utility functions for checking UI part tags and narrowing types.
 *
 * Note: These functions use naive tag presence checking only.
 * They do not perform any parsing or validation of the tag values.
 * Callers are responsible for validating the structure and content of objects.
 */

/**
 * Checks if the given value is an ElicitRequest params object.
 * @param val - The value to check
 * @returns True if val is an object containing the IsElicitationRequest tag
 */
export function isElicitationRequest(val: unknown): val is ElicitRequest['params'] {
  return typeof val === 'object' && val !== null && UIPartTag.IsElicitationRequest in val
}

/**
 * Checks if the given value is an ElicitResult object.
 * @param val - The value to check
 * @returns True if val is an object containing the IsElicitationResponse tag
 */
export function isElicitationResponse(val: unknown): val is ElicitResult {
  return typeof val === 'object' && val !== null && UIPartTag.IsElicitationResponse in val
}

/**
 * Checks if the given value is a continuation object.
 * @param val - The value to check
 * @returns True if val is an object containing the IsContinuation tag
 */
export function isContinuation(val: unknown): val is { [UIPartTag.IsContinuation]: true } {
  return typeof val === 'object' && val !== null && UIPartTag.IsContinuation in val
}

/**
 * Extracts the intent string from the given value if present.
 * @param val - The value to extract the intent from
 * @returns The intent string if found and valid, otherwise undefined
 */
export function getToolCallIntent(val: unknown): string | undefined {
  const hasIntent = typeof val === 'object' && val !== null && UIPartTag.ToolCallIntent in val
  const intent = hasIntent ? val[UIPartTag.ToolCallIntent] : undefined
  return typeof intent === 'string' ? intent : undefined
}

export const toolIntentSchema = z.object({
  [UIPartTag.ToolCallIntent]: z.string().describe('用1～2句话描述调用该工具的意图'),
})
