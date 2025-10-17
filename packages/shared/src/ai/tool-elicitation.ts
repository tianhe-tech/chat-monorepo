import type { DynamicToolUIPart } from 'ai'
import type { ElicitResult } from '@modelcontextprotocol/sdk/types.js'
import { UIPartBrands, isElicitationRequest } from '../types'
import { err, ok, Result } from 'neverthrow'
import { z } from 'zod'
import { convertJsonSchemaToZod } from 'zod-from-json-schema'

type ResolveElicitationRequestParams = {
  part: DynamicToolUIPart
}

type MCPElicitationResponseUIPart = DynamicToolUIPart & {
  state: 'output-available'
  output: {
    [UIPartBrands.ElicitationResponse]: ElicitResult
  }
}

// https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation#protocol-messages
export type ResolveElicitationRequestReturn = {
  message: string
  jsonSchema: object
  zodSchema: z.ZodType
  accept: (content: unknown) => Result<MCPElicitationResponseUIPart, unknown>
  decline: () => MCPElicitationResponseUIPart
  cancel: () => MCPElicitationResponseUIPart
}

export function resolveElicitationRequest({
  part,
}: ResolveElicitationRequestParams): Result<ResolveElicitationRequestReturn, Error> {
  const output = part.output
  if (!isElicitationRequest(output)) {
    return err(new Error('Part is not an elicitation request'))
  }

  const request = output[UIPartBrands.ElicitationRequest]
  const jsonSchema = request.requestedSchema
  const zodSchema = jsonSchema ? convertJsonSchemaToZod(jsonSchema) : z.any()

  const withResult = (result: ElicitResult) =>
    ({
      ...part,
      output: {
        [UIPartBrands.ElicitationResponse]: result,
      },
    }) as MCPElicitationResponseUIPart

  return ok({
    accept: (content: unknown) => {
      const parse = Result.fromThrowable(() => zodSchema.parse(content))
      return parse().map((content) => withResult({ action: 'accept', content }))
    },
    decline: () => withResult({ action: 'decline' }),
    cancel: () => withResult({ action: 'cancel' }),
    message: request.message,
    jsonSchema,
    zodSchema,
  })
}
