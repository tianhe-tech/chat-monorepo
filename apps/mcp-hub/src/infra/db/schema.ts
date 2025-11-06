import * as p from 'drizzle-orm/pg-core'
import { timestamps } from './helpers/columns'

export const mcp = p.pgSchema('mcp')
export const mcpTransportEnum = mcp.enum('transport', ['sse', 'streamable_http', 'stdio'])

export const mcpServerConfig = mcp.table(
  'server_configs',
  {
    id: p.serial().primaryKey(),
    userId: p.text().notNull(),
    scope: p.text().notNull(),
    name: p.text().notNull(),
    transport: mcpTransportEnum().notNull(),
    url: p.text(),
    command: p.text().array(),
    requestInit: p.json().$type<{ headers?: Record<string, string> }>(),
    ...timestamps,
  },
  (t) => [
    p.unique().on(t.userId, t.scope, t.name),
    p.unique().on(t.userId, t.scope, t.url),
    p.unique().on(t.userId, t.scope, t.command),
  ],
)
