import {
  CallToolRequestSchema,
  CallToolResultSchema,
  CreateMessageRequestSchema,
  CreateMessageResultSchema,
  ElicitRequestSchema,
  ElicitResultSchema,
  ProgressSchema,
} from '@modelcontextprotocol/sdk/types.js'
import assert from 'node:assert/strict'
import z from 'zod'
import z3 from 'zodv3'

const QUALIFIED_TOOL_NAME_REGEX = /([\w-]+?)\_([\w-]+)/

export const qualifiedToolNameSchema = z.codec(
  z.string().regex(QUALIFIED_TOOL_NAME_REGEX),
  z.object({
    serverName: z.string().nonempty(),
    toolName: z.string().nonempty(),
  }),
  {
    encode: (value) => `${value.serverName}_${value.toolName}`,
    decode: (qualifiedToolName) => {
      const matches = QUALIFIED_TOOL_NAME_REGEX.exec(qualifiedToolName)
      assert.equal(matches?.length, 3)
      const [, serverName, toolName] = matches
      return { serverName, toolName }
    },
  },
)

const toolCallSchema = <T extends z3.AnyZodObject>(data: T) =>
  z3.object({
    id: z3.string(),
    data,
  })

const extended = { toolCallId: z3.string() }

export const elicitationRequestSchema = toolCallSchema(ElicitRequestSchema.shape.params.extend(extended))
export const elicitationResultSchema = toolCallSchema(ElicitResultSchema.extend(extended))
export const progressSchema = toolCallSchema(ProgressSchema.extend(extended))
export const toolCallRequestSchema = toolCallSchema(CallToolRequestSchema.shape.params.extend(extended))
export const toolCallResultSchema = toolCallSchema(CallToolResultSchema.extend(extended))
export const samplingRequestSchema = toolCallSchema(CreateMessageRequestSchema.shape.params.extend(extended))
export const samplingResultSchema = toolCallSchema(CreateMessageResultSchema.extend(extended))

export type ElicitationRequest = z3.infer<typeof elicitationRequestSchema>
export type ElicitationResult = z3.infer<typeof elicitationResultSchema>
export type Progress = z3.infer<typeof progressSchema>
export type ToolCallRequest = z3.infer<typeof toolCallRequestSchema>
export type ToolCallResult = z3.infer<typeof toolCallResultSchema>
export type SamplingRequest = z3.infer<typeof samplingRequestSchema>
export type SamplingResult = z3.infer<typeof samplingResultSchema>
