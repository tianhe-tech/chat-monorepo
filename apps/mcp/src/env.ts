import { createEnv } from '@t3-oss/env-core'
import { safeDestr } from 'destr'
import { Result } from 'neverthrow'
import { z } from 'zod'

const jsonString = z.string().transform((val, ctx) => {
  const result = Result.fromThrowable(() => safeDestr(val))()
  if (result.isErr()) {
    ctx.addIssue({
      code: 'custom',
      message: 'Invalid JSON string',
      input: val,
    })
    return z.NEVER
  }
  return result.value
})

export const env = createEnv({
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  server: {
    PORT: z.coerce.number().default(3002),
    PG_CONNECTION_STRING: z.string(),
    MCP_CACHE_TTL_MS: z.coerce.number().default(300_000),
    TRUSTED_MCP_ORIGINS: jsonString.transform((val, ctx) => {
      const { success, data, error } = z.array(z.url()).safeParse(val)
      if (!success) {
        ctx.addIssue({
          code: 'custom',
          message: error.message,
          input: val,
        })
        return z.NEVER
      }
      return data
    }),
    VALKEY_ADDRESSES: jsonString.transform((val, ctx) => {
      const { success, data, error } = z.array(z.string()).safeParse(val)
      if (!success) {
        ctx.addIssue({
          code: 'custom',
          message: error.message,
          input: val,
        })
        return z.NEVER
      }
      return data.map((fullAddr) => {
        const [host, port = '6379'] = fullAddr.split(':')
        return { host, port: Number(port) }
      })
    }),
  },
})
