import { Hono } from 'hono'
import { logger } from 'hono/logger'
import configsApp from './configs'
import authMiddleware from '../middlewares/auth'
import toolsApp from './tools'
import { consola } from 'consola'

const app = new Hono()
  .use(logger(consola.debug), authMiddleware)
  .route('/configs', configsApp)
  .route('/tools', toolsApp)

export default app
export type AppType = typeof app
