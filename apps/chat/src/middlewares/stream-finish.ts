import { createMiddleware } from 'hono/factory'
import { consola } from 'consola'
import { EventEmitter } from 'node:events'

const logger = consola.withTag('Stream Finish Middleware')

type EventMap = {
  streamFinish: []
}

const streamFinishMiddleware = createMiddleware(async (c, next) => {
  const emitter = new EventEmitter<EventMap>()
  c.set('onStreamFinish', (fn: () => void) => emitter.on('streamFinish', fn))

  await next()

  const body = c.res.body
  if (body) {
    logger.debug('Streaming...')
    const ts = new TransformStream()
    body.pipeTo(ts.writable).finally(() => {
      logger.debug('Stream finished')
      emitter.emit('streamFinish')
      emitter.removeAllListeners()
    })
    c.res = c.newResponse(ts.readable)
  }
})

export default streamFinishMiddleware

declare module 'hono' {
  interface ContextVariableMap {
    onStreamFinish: (fn: () => void) => void
  }
}
