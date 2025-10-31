import type { MCPServerConfig } from '@th-chat/shared/contracts/mcp-server-config'
import { errAsync } from 'neverthrow'
import { DrizzleMCPServerConfigRepo } from '../../infra/mcp-server-config-repo'

export class DuplicateConfigError extends Error {}
export class NotFoundError extends Error {}

export function createMCPServerConfigUseCase(props: { userId: string; scope: string }) {
  const { userId, scope } = props
  const repo = new DrizzleMCPServerConfigRepo({ userId, scope })

  return {
    create(props: { serverConfig: MCPServerConfig }) {
      const { serverConfig } = props

      return repo.checkExists(serverConfig).andThen((exists) => {
        if (exists) {
          return errAsync(new DuplicateConfigError(`Duplicate MCP Server Config: ${serverConfig}`))
        }
        return repo.create(serverConfig)
      })
    },
    delete(props: { id: number }) {
      const { id } = props

      return repo.getById(id).andThen((exists) => {
        if (!exists) {
          return errAsync(new NotFoundError(`MCP Server Config not found: ID ${id}`))
        }
        return repo.delete(id)
      })
    },
    update(props: { id: number; serverConfig: MCPServerConfig }) {
      const { id, serverConfig } = props

      return repo.getById(id).andThen((exists) => {
        if (!exists) {
          return errAsync(new NotFoundError(`MCP Server Config not found: ID ${id}`))
        }
        return repo.update(id, serverConfig)
      })
    },
    getMany() {
      return repo.getMany()
    },
    getById(props: { id: number }) {
      const { id } = props

      return repo.getById(id)
    },
  }
}
