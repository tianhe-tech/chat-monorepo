import type { CallToolResult } from '@modelcontextprotocol/sdk/types.d.ts'
import { z } from 'zod'

export const toolConfirmInputSchema = z.object({
  _confirm: z.enum(['accept', 'decline', 'cancel']).optional(),
})
export type ToolConfirmInput = z.infer<typeof toolConfirmInputSchema>

export type Tools = {
  get_slurm_partitions_info: {
    input: undefined
    output: CallToolResult
  }
  submit_slurm_job: {
    input: {
      script_content: string
      partition: string
      job_name: string
    }
    output: CallToolResult
  }
  testTool: {
    input: undefined
    output: any
  }
}
