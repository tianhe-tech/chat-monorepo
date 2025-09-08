import { Mastra } from '@mastra/core'
import * as agents from './agents/index.ts'
import * as workflows from './workflows/index.ts'
import { pgStorage } from './storage.ts'

export const mastra = new Mastra({
  storage: pgStorage,
  agents,
  workflows,
  telemetry: {
    enabled: false,
  },
})
