import { z } from 'zod'

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
