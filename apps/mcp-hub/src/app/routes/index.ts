import consola from 'consola'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import authMiddleware from '../middlewares/auth'
import configsApp from './configs'
import toolsApp from './tools'
import { createMiddleware } from 'hono/factory'

const logErr = createMiddleware(async (c, next) => {
  await next()
  if (c.error) {
    consola.error(c.error.cause ?? c.error)
  }
})

export default new Hono()
  .basePath('/api')
  .use(logger(consola.debug), authMiddleware, logErr)
  .route('/configs', configsApp)
  .route('/tools', toolsApp)
