import { drizzle } from 'drizzle-orm/node-postgres'
import { env } from '../env'
import * as schema from './schema'

export const db = drizzle({
  connection: env.PG_CONNECTION_STRING,
  casing: 'snake_case',
  schema,
})
