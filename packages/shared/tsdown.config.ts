import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    ai: 'src/ai/index.ts',
    db: 'src/db/index.ts',
  },
  platform: 'neutral',
  dts: true,
  format: ['esm'],
  exports: {
    devExports: true,
  },
})
