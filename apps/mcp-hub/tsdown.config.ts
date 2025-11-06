import { defineConfig } from 'tsdown'

export default defineConfig({
  platform: 'node',
  entry: {
    index: 'src/app/index.ts',
  },
  exports: {
    devExports: true,
  },
  format: ['esm'],
  dts: true,
  tsconfig: true,
})
