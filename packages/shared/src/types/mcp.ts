import { z } from 'zod'

export const MCPMessageChannel = {
  SamplingRequest: 'mcp:sampling:request',
  SamplingResult: 'mcp:sampling:result',
  ElicitationRequest: 'mcp:elicitation:request',
  ElicitationResult: 'mcp:elicitation:result',
  ToolCallResult: 'mcp:toolcall:result',
  Progress: 'mcp:progress',
} as const

export type MCPMessageChannelString = (typeof MCPMessageChannel)[keyof typeof MCPMessageChannel]

export const mcpServerDefinitionSchema = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
})

export type MCPServerDefinition = z.infer<typeof mcpServerDefinitionSchema>
