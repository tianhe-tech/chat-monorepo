import type { ElicitResult } from '@modelcontextprotocol/sdk/types.js'
import type { DynamicToolUIPart } from 'ai'
import { err, ok, Result } from 'neverthrow'
import { z } from 'zod'
import { convertJsonSchemaToZod } from 'zod-from-json-schema'
import { isElicitationRequest } from '../types'

type ResolveElicitationRequestParams = {
  part: DynamicToolUIPart
}

// https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation#protocol-messages
export type ResolveElicitationRequestReturn = {
  message: string
  jsonSchema: object
  zodSchema: z.ZodType
  accept: (content: unknown) => Result<ElicitResult, unknown>
  decline: () => ElicitResult
  cancel: () => ElicitResult
}

export function resolveElicitationRequest({
  part,
}: ResolveElicitationRequestParams): Result<ResolveElicitationRequestReturn, Error> {
  if (!isElicitationRequest(part.output)) {
    return err(new Error('Part is not an elicitation request'))
  }

  const request = part.output
  const jsonSchema = request.requestedSchema
  const zodSchema = request.requestedSchema ? convertJsonSchemaToZod(request.requestedSchema) : z.any()

  return ok({
    accept: (content: unknown) => {
      const parse = Result.fromThrowable(() => zodSchema.parse(content))
      return parse().map((content) => ({ action: 'accept', content }))
    },
    decline: () => {
      return { action: 'decline' }
    },
    cancel: () => {
      return { action: 'cancel' }
    },
    message: request.message,
    zodSchema,
    jsonSchema,
  })
}
