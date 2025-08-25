import { Mastra } from '@mastra/core'

import { testWorkflow } from './workflows/web-search.ts'
import { webSearchAgent } from './agents/web-search.ts'


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
