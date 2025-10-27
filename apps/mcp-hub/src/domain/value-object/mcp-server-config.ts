import z from 'zod'

const httpSchemaBase = z.object({
  url: z.url(),
  requestInit: z.optional(
    z.looseObject({
      headers: z.optional(z.record(z.string(), z.string())),
    }),
  ),
})

const mcpServerConfigSchema = z.discriminatedUnion('transport', [
  z.object({
    name: z.string(),
    transport: z.literal('stdio'),
    command: z.array(z.string()),
  }),
  httpSchemaBase.extend({
    name: z.string(),
    transport: z.literal('sse'),
  }),
  httpSchemaBase.extend({
    name: z.string(),
    transport: z.literal('streamable_http'),
  }),
])

export type MCPServerConfigShape = z.infer<typeof mcpServerConfigSchema>

export class MCPServerConfig {
  readonly value: MCPServerConfigShape
  private constructor(value: MCPServerConfigShape) {
    this.value = value
  }

  static create(config: MCPServerConfigShape) {
    return new MCPServerConfig(mcpServerConfigSchema.parse(config))
  }
}
