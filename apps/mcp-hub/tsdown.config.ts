import { defineConfig } from 'tsdown'

export default defineConfig({
  platform: 'node',
  entry: {
    index: 'src/app/index.ts',
  },
  exports: {
    devExports: true,
    customExports: (exports) => {
      delete exports['.']
      return exports
    },
  },
  format: ['esm'],
  dts: true,
  tsconfig: true,
})
