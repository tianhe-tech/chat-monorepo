import { defineConfig } from 'tsdown'
import vue from 'unplugin-vue/rolldown'

export default defineConfig({
  platform: 'neutral',
  plugins: [vue({ isProduction: true })],
  dts: true,
  unbundle: true,
  format: ['esm'],
  exports: {
    devExports: true,
  },
})
