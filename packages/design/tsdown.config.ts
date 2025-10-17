import { defineConfig } from 'tsdown'
import vue from 'unplugin-vue/rolldown'

export default defineConfig({
  entry: ['src/index.ts', 'src/theme/index.ts'],
  alias: {
    '@': './src',
  },
  platform: 'browser',
  dts: {
    vue: true,
  },
  format: ['esm'],
  copy: {
    from: 'src/index.css',
    to: 'dist/index.css',
  },
  plugins: [vue()],
})
