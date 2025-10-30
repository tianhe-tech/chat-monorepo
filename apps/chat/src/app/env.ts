import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'
import { goTryRaw } from 'go-go-try'
import { safeDestr } from 'destr'

const jsonString = z.string().transform((val, ctx) => {
  const [err, parsed] = goTryRaw(() => safeDestr(val))
  if (err) {
    ctx.addIssue({
      code: 'custom',
      message: 'Invalid JSON string',
      input: val,
    })
    return z.NEVER
  }
  return parsed
})

export const env = createEnv({
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  server: {
    PORT: z.coerce.number().default(3001),
    PG_CONNECTION_STRING: z.string(),
    ONE_API_BASE_URL: z.url(),
    ONE_API_API_KEY: z.string(),
    MCP_SERVICE_URL: z.url(),
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
