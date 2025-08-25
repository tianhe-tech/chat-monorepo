import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/ai-sdk/index.ts'],
  platform: 'neutral',
  dts: true,
  format: ['esm'],
  exports: {
    devExports: true,
  },
})
