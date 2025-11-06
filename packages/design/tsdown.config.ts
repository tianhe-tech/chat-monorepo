import { defineConfig } from 'tsdown'
import vue from 'unplugin-vue/rolldown'

export default defineConfig({
  entry: 'src/**/index.ts',
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
  exports: {
    devExports: true,
    customExports(exports, context) {
      exports['.'] = { style: context.isPublish ? './dist/index.css' : './src/index.css' }
      if (context.isPublish) {
        exports['./css'] = { style: './dist/min.css' }
      }
      return exports
    },
  },
  plugins: [vue()],
})
