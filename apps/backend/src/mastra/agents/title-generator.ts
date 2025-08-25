import { Agent } from '@mastra/core'
import { modelProviderRegistry } from '../../config/model-provider-registry.ts'

export const titleGenerator = new Agent({
  name: 'title-generator',
  model: modelProviderRegistry.languageModel('one-api:Qwen3-32B'),
  instructions: 'You are a title generator',
})
