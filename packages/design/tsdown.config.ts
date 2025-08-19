import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/theme/index.ts'],
  platform: 'neutral',
  dts: true,
  format: ['esm'],
  copy: {
    from: 'src/index.css',
    to: 'dist/index.css',
  },
})
