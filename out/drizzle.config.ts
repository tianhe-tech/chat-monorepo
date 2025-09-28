import { defineConfig } from 'drizzle-kit'
import { env } from './src/env'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  casing: 'snake_case',
  dbCredentials: {
    url: env.PG_CONNECTION_STRING,
  },
})
