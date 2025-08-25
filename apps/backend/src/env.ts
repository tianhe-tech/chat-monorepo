import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

const zBoolean = z
  .string()
  .refine((s) => s === 'true' || s === 'false')
  .transform((s) => s === 'true')

export const env = createEnv({
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  server: {
    BOCHA_API_KEY: z.string(),
    PG_CONNECTION_STRING: z.string(),
    TESTING: zBoolean.optional().default('false'),
  },
})
