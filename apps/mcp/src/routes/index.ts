import { Hono } from 'hono'
import { logger } from 'hono/logger'
import configsApp from './configs'
import authMiddleware from '../middlewares/auth'
import toolsApp from './tools'

const app = new Hono()
  .use(logger(console.debug), authMiddleware)
  .route('/configs', configsApp)
  .route('/tools', toolsApp)

export default app
export type AppType = typeof app
