import * as p from 'drizzle-orm/pg-core'
import { timestamps } from './helpers/columns'
import { relations } from 'drizzle-orm'
import type { UIMessageType } from '../../domain/entity/message'

export const chat = p.pgSchema('chat')

export const roleEnum = chat.enum('role', ['user', 'assistant'])
export const messageFormatEnum = chat.enum('message_format', ['ai_v5', 'mastra_v2'])

export const thread = chat.table('threads', {
  id: p.text().primaryKey(),
  userId: p.text().notNull(),
  scope: p.text().notNull(),
  ...timestamps,
})

export const threadRelations = relations(thread, ({ many }) => ({
  messages: many(message),
}))

export const message = chat.table('messages', {
  id: p.text().primaryKey(),
  threadId: p
    .text()
    .notNull()
    .references(() => thread.id, { onDelete: 'cascade' }),
  role: roleEnum().notNull(),
  format: messageFormatEnum().notNull(),
  content: p.json().$type<UIMessageType['parts']>().notNull(),
  ...timestamps,
})

export const messageRelations = relations(message, ({ one }) => ({
  thread: one(thread, {
    fields: [message.threadId],
    references: [thread.id],
  }),
}))
