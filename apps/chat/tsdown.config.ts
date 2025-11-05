import { defineConfig } from 'tsdown'

export default defineConfig({
  platform: 'neutral',
  entry: {
    index: 'src/app/index.ts',
    routes: 'src/app/routes/index.ts',
    'db/schema': 'src/infra/db/schema.ts',
  },
  exports: {
    devExports: true,
  },
  dts: true,
  tsconfig: true,
})
