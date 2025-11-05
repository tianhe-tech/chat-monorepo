import { createDeepSeek } from '@ai-sdk/deepseek'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { createUIMessageStream, createUIMessageStreamResponse, validateUIMessages } from 'ai'
import consola from 'consola'
import { HTTPException } from 'hono/http-exception'
import { ResultAsync } from 'neverthrow'
import type { UIMessageType } from '../../domain/entity/message'
import { progressPartSchema } from '../../domain/entity/part'
import { createChatUseCase } from '../use-case/chat'

export default new OpenAPIHono().openapi(
  createRoute({
    method: 'post',
    path: '/',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              message: z.unknown(),
              threadId: z.string(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: '流式输出',
      },
    },
  }),
  async (c) => {
    const body = c.req.valid('json')
    const user = c.get('user')

    const validateResult = await ResultAsync.fromPromise(
      validateUIMessages<UIMessageType>({
        messages: [body.message],
        dataSchemas: {
          progress: progressPartSchema,
        },
      }),
      (e) => e,
    )

    if (validateResult.isErr()) {
      throw new HTTPException(400, { message: 'Invalid request body', cause: validateResult.error })
    }

    const newMessage = validateResult.value[0]
    const { threadId } = body

    const usecase = createChatUseCase({ threadId, userId: user.id, scope: user.scope, mcphubSignal: c.req.raw.signal })
    const ds = new AsyncDisposableStack()

    return createUIMessageStreamResponse({
      headers: {
        'Content-Type': 'text/event-stream',
      },
      stream: createUIMessageStream<UIMessageType>({
        originalMessages: [newMessage],
        onError(err) {
          consola.error('Error occurred while streaming:', err)
          const message = err instanceof Error ? err.message : String(err)
          return message
        },
        async execute({ writer }) {
          const model = createDeepSeek().languageModel('deepseek-chat')
          const result = await usecase.streamChat({ newMessage, writer, model })
          if (result.isErr()) {
            throw result.error
          }
          const { cleanup } = result.value
          ds.defer(cleanup)
        },
        async onFinish({ messages }) {
          await ds.disposeAsync()

          consola.debug('Saving messages to the database...')
          const results = await ResultAsync.combineWithAllErrors(
            messages.map((message) => usecase.upsertMessage(message)),
          )
          if (results.isErr()) {
            throw new Error('Failed to save messages')
          }
          consola.debug('Messages saved successfully.')
        },
      }),
    })
  },
)
