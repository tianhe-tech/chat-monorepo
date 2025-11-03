import type { MCPServerConfig } from '@th-chat/shared/contracts/mcp-server-config'
import type { ResultAsync } from 'neverthrow'

export interface UserMCPServerConfigRepo {
  readonly userId: string
  readonly scope: string
  checkExists(config: MCPServerConfig): ResultAsync<boolean, Error>
  create(config: MCPServerConfig): ResultAsync<number, Error>
  update(id: number, updateValue: MCPServerConfig): ResultAsync<void, Error>
  getMany(): ResultAsync<(MCPServerConfig & { id: number })[], Error>
  getById(id: number): ResultAsync<MCPServerConfig | undefined, Error>
  delete(id: number): ResultAsync<void, Error>
}
