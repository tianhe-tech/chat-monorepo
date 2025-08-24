import { createWorkflow, createStep } from '@mastra/core'
import { z } from 'zod'

const step = createStep({
  id: 'step-1',
  inputSchema: z.string(),
  outputSchema: z.string(),
  execute: async ({ inputData }) => {
    return inputData
  },
})

export const testWorkflow = createWorkflow({
  id: 'test-workflow',
  inputSchema: z.string(),
  outputSchema: z.string(),
})
  .then(step)
  .branch([
    [async ({ inputData }) => Boolean(inputData), step],
    [async ({ inputData }) => !inputData, step],
  ])
  .commit()
