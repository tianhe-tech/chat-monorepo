import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import consola from 'consola'
import { logger } from 'hono/logger'
import authMiddleware from '../middleware/auth'
import chatsApp from './chats'

const app = new OpenAPIHono()

app.use('*', logger(consola.debug), authMiddleware)
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
      url: '/doc',
    }),
  )

const routes = app.route('/chats', chatsApp)

export default app
export { routes }
