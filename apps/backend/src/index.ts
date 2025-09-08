import { consola } from 'consola'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'

import mcpClientApp from './routes/mcp-client.ts'
import chatApp from './routes/chat.ts'

consola.wrapConsole()

const app = new Hono().basePath('/api')
app.use(logger(consola.debug))

const routes = app.route('/mcp-client', mcpClientApp).route('/chat', chatApp)

const server = serve(
  {
    fetch: app.fetch,
    port: 3001,
  },
  (info) => {
    consola.start(`Server is running on http://localhost:${info.port}`)
  },
)

// graceful shutdown
process.on('SIGINT', () => {
  server.close()
  process.exit(0)
})
process.on('SIGTERM', () => {
  server.close((err) => {
    if (err) {
      consola.error(err)
      process.exit(1)
    }
    process.exit(0)
  })
})

export type AppType = typeof routes
