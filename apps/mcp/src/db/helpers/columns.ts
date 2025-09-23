import * as p from 'drizzle-orm/pg-core'

export const timestamps = {
  createdAt: p.timestamp({ withTimezone: true }).defaultNow(),
  updatedAt: p.timestamp({ withTimezone: true }),
  deletedAt: p.timestamp({ withTimezone: true }),
}
