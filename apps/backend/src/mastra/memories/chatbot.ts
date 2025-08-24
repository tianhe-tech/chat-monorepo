import { Memory } from '@mastra/memory'
import { fastembed } from '@mastra/fastembed'
import { PostgresStore, PgVector } from '@mastra/pg'

import { modelProviderRegistry } from '../../config/model-provider-registry.ts'
import { env } from '../../env.ts'

const storage = new PostgresStore({
  connectionString: env.PG_CONNECTION_STRING,
})
const vector = new PgVector({
  connectionString: env.PG_CONNECTION_STRING,
})

export const chatbotMemory = new Memory({
  storage,
  vector,
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
