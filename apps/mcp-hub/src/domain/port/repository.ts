import type { MCPServerConfig } from '@th-chat/shared/contracts/mcp-server-config'
import type { ResultAsync } from 'neverthrow'

export class MCPServerConfigDuplicateError extends Error {}

export interface UserMCPServerConfigRepo {
  readonly userId: string
  readonly scope: string
  upsert(config: MCPServerConfig & { id?: number }): ResultAsync<number, Error>
  getMany(): ResultAsync<(MCPServerConfig & { id: number })[], Error>
  getById(id: number): ResultAsync<MCPServerConfig | undefined, Error>
  delete(id: number): ResultAsync<void, Error>
}
