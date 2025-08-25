import { PostgresStore, PgVector } from '@mastra/pg'
import { env } from '../env.ts'

export const pgStorage = new PostgresStore({
  connectionString: env.PG_CONNECTION_STRING,
})

export const pgVector = new PgVector({
  connectionString: env.PG_CONNECTION_STRING,
})
