import type { ResultAsync } from 'neverthrow'
import type { MCPServerConfig } from '@th-chat/shared/contracts/mcp-server-config'

export abstract class MCPServerConfigRepo {
  readonly userId: string
  readonly scope: string
  constructor(props: { userId: string; scope: string }) {
    this.userId = props.userId
    this.scope = props.scope
  }
  abstract checkExists(config: MCPServerConfig): ResultAsync<boolean, Error>
  abstract create(config: MCPServerConfig): ResultAsync<number, Error>
  abstract update(id: number, updateValue: MCPServerConfig): ResultAsync<void, Error>
  abstract getMany(): ResultAsync<(MCPServerConfig & { id: number })[], Error>
  abstract getById(id: number): ResultAsync<MCPServerConfig | undefined, Error>
  abstract delete(id: number): ResultAsync<void, Error>
}
