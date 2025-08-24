import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createProviderRegistry } from 'ai'

export const modelProviderRegistry = createProviderRegistry({
  'one-api': createOpenAICompatible({
    name: 'one-api',
    baseURL: 'http://192.168.5.10:3000/v1',
    apiKey: 'sk-ICERFam8VpvQ3tsE3413B6B6Fc674966B1330cFaFbEd2836',
  }),
})
