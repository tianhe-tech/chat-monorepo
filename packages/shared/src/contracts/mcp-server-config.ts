import z from 'zod'

const httpSchemaBase = z.object({
  url: z.url(),
  requestInit: z.optional(
    z.looseObject({
      headers: z.optional(z.record(z.string(), z.string())),
    }),
  ),
})

const stdioSchema = z.object({
  name: z.string(),
  transport: z.literal('stdio'),
  command: z.array(z.string()),
})
const sseSchema = httpSchemaBase.extend({
  name: z.string(),
  transport: z.literal('sse'),
})
const streamableHttpSchema = httpSchemaBase.extend({
  name: z.string(),
  transport: z.literal('streamable_http'),
})

export const mcpServerConfigSchema = z.discriminatedUnion('transport', [stdioSchema, sseSchema, streamableHttpSchema])

export type MCPServerConfig = z.infer<typeof mcpServerConfigSchema>
