import { z } from 'zod'

const progressTokenSchema = z.union([z.string(), z.number().int()])

const looseUnknownObject = z.looseObject({})

const requestMetaSchema = z.looseObject({
  progressToken: progressTokenSchema.optional(),
})

const baseRequestParamsSchema = z.looseObject({
  _meta: requestMetaSchema.optional(),
})

const resultBaseSchema = z.looseObject({
  _meta: looseUnknownObject.optional(),
})

const iconSchema = z.looseObject({
  src: z.string(),
  mimeType: z.string().optional(),
  sizes: z.array(z.string()).optional(),
})

const iconsShape = {
  icons: z.array(iconSchema).optional(),
} as const

const baseMetadataSchema = z.looseObject({
  name: z.string(),
  title: z.string().optional(),
})

const base64Schema = z.string().refine((value) => {
  try {
    const normalized = value.replace(/[\r\n]+/g, '')
    return Buffer.from(normalized, 'base64').toString('base64') === normalized
  } catch {
    return false
  }
}, 'Invalid Base64 string')

const resourceContentsSchema = z.looseObject({
  uri: z.string(),
  mimeType: z.string().optional(),
  _meta: looseUnknownObject.optional(),
})

const textResourceContentsSchema = resourceContentsSchema.extend({
  text: z.string(),
})

const blobResourceContentsSchema = resourceContentsSchema.extend({
  blob: base64Schema,
})

const resourceSchema = baseMetadataSchema.extend({
  uri: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  _meta: looseUnknownObject.optional(),
  ...iconsShape,
})

const embeddedResourceSchema = z.looseObject({
  type: z.literal('resource'),
  resource: z.union([textResourceContentsSchema, blobResourceContentsSchema]),
  _meta: looseUnknownObject.optional(),
})

const resourceLinkSchema = resourceSchema.extend({
  type: z.literal('resource_link'),
})

const toolAnnotationsSchema = z.looseObject({
  title: z.string().optional(),
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
})

const textContentSchema = z.looseObject({
  type: z.literal('text'),
  text: z.string(),
  _meta: looseUnknownObject.optional(),
})

const imageContentSchema = z.looseObject({
  type: z.literal('image'),
  data: base64Schema,
  mimeType: z.string(),
  _meta: looseUnknownObject.optional(),
})

const audioContentSchema = z.looseObject({
  type: z.literal('audio'),
  data: base64Schema,
  mimeType: z.string(),
  _meta: looseUnknownObject.optional(),
})

const contentBlockSchema = z.union([
  textContentSchema,
  imageContentSchema,
  audioContentSchema,
  resourceLinkSchema,
  embeddedResourceSchema,
])

const modelHintSchema = z.looseObject({
  name: z.string().optional(),
})

const modelPreferencesSchema = z.looseObject({
  hints: z.array(modelHintSchema).optional(),
  costPriority: z.number().min(0).max(1).optional(),
  speedPriority: z.number().min(0).max(1).optional(),
  intelligencePriority: z.number().min(0).max(1).optional(),
})

const samplingMessageSchema = z.looseObject({
  role: z.enum(['user', 'assistant']),
  content: z.union([textContentSchema, imageContentSchema, audioContentSchema]),
})

const booleanSchemaSchema = z.looseObject({
  type: z.literal('boolean'),
  title: z.string().optional(),
  description: z.string().optional(),
  default: z.boolean().optional(),
})

const stringSchemaSchema = z.looseObject({
  type: z.literal('string'),
  title: z.string().optional(),
  description: z.string().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  format: z.enum(['email', 'uri', 'date', 'date-time']).optional(),
})

const numberSchemaSchema = z.looseObject({
  type: z.enum(['number', 'integer']),
  title: z.string().optional(),
  description: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
})

const enumSchemaSchema = z.looseObject({
  type: z.literal('string'),
  title: z.string().optional(),
  description: z.string().optional(),
  enum: z.array(z.string()),
  enumNames: z.array(z.string()).optional(),
})

const primitiveSchemaDefinitionSchema = z.union([
  booleanSchemaSchema,
  stringSchemaSchema,
  numberSchemaSchema,
  enumSchemaSchema,
])

const jsonSchemaObject = z.looseObject({
  type: z.literal('object'),
  properties: looseUnknownObject.optional(),
  required: z.array(z.string()).optional(),
})

export const ProgressSchema = z.looseObject({
  progress: z.number(),
  total: z.number().optional(),
  message: z.string().optional(),
})

export const CallToolRequestSchema = z.object({
  method: z.literal('tools/call'),
  params: baseRequestParamsSchema.extend({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const CallToolResultSchema = resultBaseSchema.extend({
  content: z.array(contentBlockSchema).default([]),
  structuredContent: looseUnknownObject.optional(),
  isError: z.boolean().optional(),
})

export const ToolSchema = baseMetadataSchema.extend({
  description: z.string().optional(),
  inputSchema: jsonSchemaObject,
  outputSchema: jsonSchemaObject.optional(),
  annotations: toolAnnotationsSchema.optional(),
  _meta: looseUnknownObject.optional(),
  ...iconsShape,
})

export const CreateMessageRequestSchema = z.object({
  method: z.literal('sampling/createMessage'),
  params: baseRequestParamsSchema.extend({
    messages: z.array(samplingMessageSchema),
    systemPrompt: z.string().optional(),
    includeContext: z.enum(['none', 'thisServer', 'allServers']).optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int(),
    stopSequences: z.array(z.string()).optional(),
    metadata: looseUnknownObject.optional(),
    modelPreferences: modelPreferencesSchema.optional(),
  }),
})

export const CreateMessageResultSchema = resultBaseSchema.extend({
  model: z.string(),
  stopReason: z.enum(['endTurn', 'stopSequence', 'maxTokens']).or(z.string()).optional(),
  role: z.enum(['user', 'assistant']),
  content: z.discriminatedUnion('type', [textContentSchema, imageContentSchema, audioContentSchema]),
})

export const ElicitRequestSchema = z.object({
  method: z.literal('elicitation/create'),
  params: baseRequestParamsSchema.extend({
    message: z.string(),
    requestedSchema: z.looseObject({
      type: z.literal('object'),
      properties: z.record(z.string(), primitiveSchemaDefinitionSchema),
      required: z.array(z.string()).optional(),
    }),
  }),
})

export const ElicitResultSchema = resultBaseSchema.extend({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.record(z.string(), z.unknown()).optional(),
})
