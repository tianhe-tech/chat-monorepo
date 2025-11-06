import { defineConfig } from 'tsdown'
import vue from 'unplugin-vue/rolldown'

export default defineConfig({
  platform: 'browser',
  entry: {
    index: 'src/index.ts',
    ai: 'src/ai/index.ts',
  },
  plugins: [vue({ isProduction: true })],
  dts: true,
  unbundle: true,
  format: ['esm'],
  exports: {
    devExports: true,
  },
})
