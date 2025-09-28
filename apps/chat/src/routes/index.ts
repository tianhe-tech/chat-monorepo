import { consola } from 'consola'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import authMiddleware from '../middlewares/auth'
import chatApp from './chats'

const app = new Hono().use(logger(consola.debug), authMiddleware).route('/chats', chatApp)

export default app
