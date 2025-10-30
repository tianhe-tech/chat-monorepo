import consola from 'consola'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import authMiddleware from '../middleware/auth'
import chatsApp from './chats'

export default new Hono().use(logger(consola.debug), authMiddleware).route('/chats', chatsApp)
