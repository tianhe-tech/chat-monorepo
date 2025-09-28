import * as p from 'drizzle-orm/pg-core'
import { timestamps } from './helpers/columns'

export const mcp = p.pgSchema('mcp')
export const mcpTransportEnum = mcp.enum('transport', ['sse', 'streamable_http'])

export const mcpServerConfig = mcp.table('server_configs', {
  id: p.serial().primaryKey(),
  userId: p.text().notNull(),
  scope: p.text().notNull(),
  name: p.text().notNull().unique(),
  transport: mcpTransportEnum().notNull(),
  url: p.text().notNull().unique(),
  requestInit: p.json().$type<{ headers?: Record<string, string> }>(),
  ...timestamps,
})
