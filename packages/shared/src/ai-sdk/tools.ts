import type { CallToolResult } from '@modelcontextprotocol/sdk/types.d.ts'

// Base confirmation types
export interface ToolConfirmationRequest<T> {
  _confirm: 'request'
  message: string
  data?: T
}

export interface ToolConfirmationResponse<T> {
  _confirm: 'result'
  action: 'accept' | 'decline' | 'cancel'
  data?: T
}

// Extended tool result type that can handle confirmations
export type ToolResultWithConfirmation<T = unknown, TReq = unknown, TRes = unknown> =
  | T
  | ToolConfirmationRequest<TReq>
  | ToolConfirmationResponse<TRes>

export type Tools = {
  get_slurm_partitions_info: {
    input: undefined
    output: ToolResultWithConfirmation<CallToolResult>
  }
  submit_slurm_job: {
    input: {
      script_content: string
      partition: string
      job_name: string
    }
    output: ToolResultWithConfirmation<CallToolResult>
  }
  testTool: {
    input: undefined
    output: any
  }
}
