import { defineConfig } from 'tsdown'

export default defineConfig({
  platform: 'node',
  entry: {
    index: 'src/index.ts',
    mcp: 'src/mcp/index.ts',
    routes: 'src/routes/index.ts',
  },
  dts: true,
  tsconfig: true,
})
