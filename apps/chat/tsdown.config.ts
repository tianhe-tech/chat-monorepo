import { defineConfig } from 'tsdown'

export default defineConfig({
  platform: 'neutral',
  entry: {
    index: 'src/app/index.ts',
  },
  exports: {
    devExports: true,
  },
  dts: true,
  tsconfig: true,
})
