import { createMiddleware } from 'hono/factory'

export default createMiddleware(async (c, next) => {
  c.set('user', {
    id: 'default',
    scope: 'global',
  })
  await next()
})

declare module 'hono' {
  interface ContextVariableMap {
    user: { id: string; scope: string }
  }
}
