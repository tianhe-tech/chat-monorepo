import { defineConfig } from 'tsdown'

export default defineConfig({
  platform: 'node',
  entry: {
    index: 'src/index.ts',
    mcp: 'src/mcp/index.ts',
    routes: 'src/routes/index.ts',
    'db/schema': 'src/db/schema.ts',
  },
  exports: {
    devExports: true,
  },
  format: ['esm'],
  dts: true,
  tsconfig: true,
})
