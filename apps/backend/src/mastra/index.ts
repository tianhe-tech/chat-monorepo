import { Mastra } from '@mastra/core'
import { PostgresStore } from '@mastra/pg'

import { testWorkflow } from './workflows/web-search.ts'
import { env } from '../env.ts'
import { webSearchAgent } from './agents/web-search.ts'

const storage = new PostgresStore({
  connectionString: env.PG_CONNECTION_STRING,
})

export const mastra = new Mastra({
  storage,
  workflows: {
    testWorkflow,
  },
  agents: {
    webSearchAgent,
  },
  telemetry: {
    enabled: false,
  },
})
