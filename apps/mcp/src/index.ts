import { serve } from '@hono/node-server'
import { consola } from 'consola'
import { gracefulExit } from 'exit-hook'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { env } from './env'
import configsApp from './routes/configs'
import authMiddleware from './middlewares/auth'
import toolsApp from './routes/tools'

consola.wrapConsole()
consola.options.formatOptions.colors = true

const app = new Hono()
  .use(logger(consola.debug), authMiddleware)
  .route('/configs', configsApp)
  .route('/tools', toolsApp)

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

export default app
export type AppType = typeof app
