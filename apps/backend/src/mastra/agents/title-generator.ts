import { Agent } from '@mastra/core'
import { modelProviderRegistry } from '../../config/model-provider-registry.ts'

// 用于无 agent 能力的模型对话生成标题, 应该是个小模型
const titleGenerator = new Agent({
  name: 'title-generator',
  model: modelProviderRegistry.languageModel('one-api:Qwen3-32B'),
  instructions: 'You are a title generator',
})

export default titleGenerator