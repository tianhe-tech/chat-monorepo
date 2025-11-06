import { defineConfig } from 'tsdown'

export default defineConfig({
  platform: 'neutral',
  entry: {
    index: 'src/app/index.ts',
    domain: 'src/domain/index.ts',
  },
  exports: {
    devExports: true,
    customExports: (exports) => {
      delete exports['.']
      return exports
    },
  },
  dts: true,
  tsconfig: true,
})
