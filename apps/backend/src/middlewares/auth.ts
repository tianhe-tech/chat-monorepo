import { createMiddleware } from 'hono/factory'
import { consola } from 'consola'

const authMiddleware = createMiddleware(async (c, next) => {
  const id = c.req.header('Fake-Id') ?? 'default'
  c.set('userId', id)
  consola.info('user id:', id)
  await next()
})

export default authMiddleware

declare module 'hono' {
  interface ContextVariableMap {
    userId: string
  }
}
