import { createMiddleware } from 'hono/factory'

const authMiddleware = createMiddleware(async (c, next) => {
  c.set('user', {
    id: 'default',
    scope: 'global',
  })
  await next()
})

export default authMiddleware

declare module 'hono' {
  interface ContextVariableMap {
    user: { id: string; scope: string }
  }
}
