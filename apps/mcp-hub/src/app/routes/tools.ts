import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import z from 'zod'
import { createMCPHubUseCase, NotFoundError } from '../use-case/mcp-hub.ts'
import * as Contract from '@internal/shared/contracts/chat-mcp-hub'

const mcpThreadIdMiddleware = zValidator(
  'header',
  z.object({
    'mcp-thread-id': z.string(),
  }),
)

export default new Hono()
  .get('/', mcpThreadIdMiddleware, async (c) => {
    const user = c.get('user')
    const { 'mcp-thread-id': threadId } = c.req.valid('header')

    const result = await createMCPHubUseCase({ userId: user.id, scope: user.scope, threadId }).andThen((usecase) =>
      usecase.listTools(),
    )

    if (result.isOk()) {
      return c.json(result.value)
    }
    if (result.error instanceof NotFoundError) {
      throw new HTTPException(404, { cause: result.error })
    }
    throw new HTTPException(500, { cause: result.error })
  })
  .post('/', mcpThreadIdMiddleware, zValidator('json', z.unknown()), async (c) => {
    const user = c.get('user')
    const { 'mcp-thread-id': threadId } = c.req.valid('header')
    const body = await c.req.json()
    const { success, data, error } = Contract.toolCallRequestSchema.shape.data.safeParse(body)
    if (!success) {
      throw new HTTPException(400, { message: 'Invalid request body', cause: error })
    }

    const result = await createMCPHubUseCase({ userId: user.id, scope: user.scope, threadId }).andThen((usecase) =>
      usecase.callTool(data),
    )

    if (result.isOk()) {
      return c.json(result.value)
    }
    throw new HTTPException(500, { cause: result.error })
  })
