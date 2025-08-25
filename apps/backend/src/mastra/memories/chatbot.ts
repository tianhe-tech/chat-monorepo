import { Memory } from '@mastra/memory'
import { fastembed } from '@mastra/fastembed'

import { modelProviderRegistry } from '../../config/model-provider-registry.ts'
import { pgStorage, pgVector } from '../storage.ts'

export const chatbotMemory = new Memory({
  storage: pgStorage,
  vector: pgVector,
  embedder: fastembed,
  options: {
    lastMessages: 10,
    threads: {
      generateTitle: {
        model: modelProviderRegistry.languageModel('one-api:Qwen3-235B-A22B'),
      },
    },
    semanticRecall: {
      messageRange: 2,
      topK: 3,
      scope: 'thread',
    },
  },
})
