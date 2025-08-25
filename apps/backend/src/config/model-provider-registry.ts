import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createProviderRegistry } from 'ai'

import { env } from '../env.ts'

export const modelProviderRegistry = createProviderRegistry({
  'one-api': createOpenAICompatible({
    name: 'one-api',
    baseURL: env.ONE_API_BASE_URL,
    apiKey: env.ONE_API_API_KEY,
  }),
})
