import { constructDBError } from '@internal/shared/utils'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { ResultAsync } from 'neverthrow'
import { db } from './db'
import * as schema from './db/schema'
import type { UIMessageType } from '../domain/entity/message'
import { ThreadRepo } from '../domain/port/repository'

type ThreadSelect = typeof schema.thread.$inferSelect
type ThreadInsert = typeof schema.thread.$inferInsert
type MessageSelect = typeof schema.message.$inferSelect
type MessageInsert = typeof schema.message.$inferInsert
type PersistableRole = Exclude<MessageInsert['role'], null | undefined>
type MessageFormat = Exclude<MessageInsert['format'], null | undefined>

const DEFAULT_MESSAGE_FORMAT: MessageFormat = 'ai_v5'

class ThreadOwnershipError extends Error {
  constructor(threadId: string) {
    super(`Thread "${threadId}" is not accessible for the current user or scope.`)
    this.name = 'ThreadOwnershipError'
  }
}

export class DrizzleThreadRepo extends ThreadRepo {
  getThreads(): ResultAsync<{ id: string; name: string }[], Error> {
    const { userId, scope } = this

    return ResultAsync.fromPromise(
      db.query.thread
        .findMany({
          where: (thread, { and, eq, isNull }) =>
            and(eq(thread.userId, userId), eq(thread.scope, scope), isNull(thread.deletedAt)),
          orderBy: (thread, { desc }) => [desc(thread.updatedAt)],
        })
        .then((threads) => threads.map((thread) => ({ id: thread.id, name: thread.id }))),
      (e) => new Error('Failed to get threads', { cause: e }),
    )
  }

  getThreadMessages(threadId: string): ResultAsync<UIMessageType[], Error> {
    return ResultAsync.fromPromise(
      (async () => {
        const thread = await this.#findThreadWithMessages(threadId)

        if (!thread) {
          await this.#ensureThread(threadId)
          return []
        }

        return thread.messages.map(this.#mapMessageRowToUI)
      })(),
      (e) => new Error(`Failed to get messages for thread "${threadId}"`, { cause: e }),
    )
  }

  upsertMessage(threadId: string, message: UIMessageType): ResultAsync<void, Error> {
    const role = this.#assertPersistableRole(message.role)

    return ResultAsync.fromPromise(
      (async () => {
        await this.#ensureThread(threadId)

        const payload: MessageInsert = {
          id: message.id,
          threadId,
          role,
          format: DEFAULT_MESSAGE_FORMAT,
          content: message.parts,
          deletedAt: null,
        }

        await db
          .insert(schema.message)
          .values(payload)
          .onConflictDoUpdate({
            target: schema.message.id,
            set: {
              role: payload.role,
              format: payload.format,
              content: payload.content,
              deletedAt: null,
              updatedAt: sql`now()`,
            },
          })
      })(),
      (e) => new Error(`Failed to upsert message "${message.id}" in thread "${threadId}"`, { cause: e }),
    )
  }

  deleteThread(threadId: string): ResultAsync<void, Error> {
    const { userId, scope } = this
    const now = new Date()

    return ResultAsync.fromPromise(
      db.transaction(async (tx) => {
        const [updatedThread] = await tx
          .update(schema.thread)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(schema.thread.id, threadId),
              eq(schema.thread.userId, userId),
              eq(schema.thread.scope, scope),
              isNull(schema.thread.deletedAt),
            ),
          )
          .returning({ id: schema.thread.id })

        if (!updatedThread) {
          return
        }

        await tx
          .update(schema.message)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(schema.message.threadId, threadId))
      }),
      (e) => new Error(`Failed to delete thread "${threadId}"`, { cause: e }),
    )
  }

  #assertPersistableRole(role: UIMessageType['role']): PersistableRole {
    if (role === 'assistant' || role === 'user') {
      return role
    }

    throw new Error(`Unsupported message role: ${role}`)
  }

  async #ensureThread(threadId: string): Promise<void> {
    const existing = await this.#findThreadRecord(threadId)
    if (existing) {
      return
    }

    const payload: ThreadInsert = { id: threadId, userId: this.userId, scope: this.scope }

    await db.insert(schema.thread).values(payload).onConflictDoNothing({ target: schema.thread.id })

    const confirmed = await this.#findThreadRecord(threadId)
    if (!confirmed) {
      throw new ThreadOwnershipError(threadId)
    }
  }

  #findThreadRecord(threadId: string): Promise<ThreadSelect | undefined> {
    const { userId, scope } = this

    return db.query.thread.findFirst({
      where: (thread, { and, eq }) => and(eq(thread.id, threadId), eq(thread.userId, userId), eq(thread.scope, scope)),
    })
  }

  #findThreadWithMessages(threadId: string): Promise<(ThreadSelect & { messages: MessageSelect[] }) | undefined> {
    const { userId, scope } = this

    return db.query.thread.findFirst({
      where: (thread, { and, eq, isNull }) =>
        and(eq(thread.id, threadId), eq(thread.userId, userId), eq(thread.scope, scope), isNull(thread.deletedAt)),
      with: {
        messages: {
          orderBy: (message, { asc }) => [asc(message.createdAt)],
          where: (message, { isNull }) => isNull(message.deletedAt),
        },
      },
    })
  }

  #mapMessageRowToUI(message: MessageSelect): UIMessageType {
    return {
      id: message.id,
      role: message.role,
      parts: message.content,
    }
  }
}
