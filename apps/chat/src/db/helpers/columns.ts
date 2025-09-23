import { sql } from 'drizzle-orm'
import * as p from 'drizzle-orm/pg-core'

export const timestamps = {
  createdAt: p.timestamp({ withTimezone: true }).defaultNow(),
  updatedAt: p.timestamp({ withTimezone: true }).$onUpdate(() => sql`now()`),
  deletedAt: p.timestamp({ withTimezone: true }),
}
