import consola from 'consola'
import { OpenAPIHono } from '@hono/zod-openapi'
import { logger } from 'hono/logger'
import authMiddleware from '../middlewares/auth'
import configsApp from './configs'
import toolsApp from './tools'
import { createMiddleware } from 'hono/factory'
import { Scalar } from '@scalar/hono-api-reference'

const logErr = createMiddleware(async (c, next) => {
  await next()
  if (c.error) {
    consola.error(c.error.cause ?? c.error)
  }
})

const app = new OpenAPIHono().basePath('/api')

app.use('*', logger(consola.debug), authMiddleware, logErr)
app
  .doc('/doc', {
    openapi: '3.0.0',
    info: {
      title: 'MCP Hub API',
      version: '1',
    },
  })
  .get(
    '/ui',
    Scalar({
      url: '/api/doc',
    }),
  )
const routes = app.route('/configs', configsApp).route('/tools', toolsApp)

export default app
export { routes }
