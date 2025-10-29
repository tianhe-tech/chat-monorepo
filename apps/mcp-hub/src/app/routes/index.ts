import consola from 'consola'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import authMiddleware from '../middlewares/auth'
import configsApp from './configs'
import toolsApp from './tools'

export default new Hono()
  .basePath('/api')
  .use(logger(consola.debug), authMiddleware)
  .route('/configs', configsApp)
  .route('/tools', toolsApp)
