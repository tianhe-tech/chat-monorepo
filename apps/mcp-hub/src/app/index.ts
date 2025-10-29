import { serve } from '@hono/node-server'
import { consola } from 'consola'
import { gracefulExit } from 'exit-hook'
import { env } from './app/env'
import app from './routes'

consola.wrapConsole()
consola.options.formatOptions.colors = true

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    consola.start(`Server is running on http://${info.address}:${info.port}`)
  },
)

// graceful shutdown
process.on('SIGINT', () => {
  server.close()
  gracefulExit(0)
})
process.on('SIGTERM', () => {
  server.close((err) => {
    if (err) {
      consola.error(err)
      gracefulExit(1)
    }
    gracefulExit(0)
  })
})
