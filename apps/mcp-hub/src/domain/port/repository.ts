import type { Result } from 'neverthrow'
import type { MCPServerConfig } from '../value-object/mcp-server-config'

export interface MCPServerConfigRepo {
  checkExists(config: MCPServerConfig): Result<boolean, Error>
  create(config: MCPServerConfig): Result<number, Error>
  update(id: number, updateValue: Partial<MCPServerConfig>): Result<void, Error>
  getMany(): Result<MCPServerConfig[], Error>
  getById(id: number): Result<MCPServerConfig | undefined, Error>
  delete(id: number): Result<void, Error>
}
