import type { MCPServerConfig } from '@th-chat/shared/contracts/mcp-server-config'
import { errAsync } from 'neverthrow'
import type { UserMCPServerConfigRepo } from '../../domain/port/repository'

export class DuplicateConfigError extends Error {}
export class NotFoundError extends Error {}

type Params = {
  repo: UserMCPServerConfigRepo
}

export function createMCPServerConfigUseCase({ repo }: Params) {
  return {
    create(params: { serverConfig: MCPServerConfig }) {
      const { serverConfig } = params

      return repo.checkExists(serverConfig).andThen((exists) => {
        if (exists) {
          return errAsync(new DuplicateConfigError(`Duplicate MCP Server Config: ${serverConfig}`))
        }
        return repo.create(serverConfig)
      })
    },
    delete(params: { id: number }) {
      const { id } = params

      return repo.getById(id).andThen((exists) => {
        if (!exists) {
          return errAsync(new NotFoundError(`MCP Server Config not found: ID ${id}`))
        }
        return repo.delete(id)
      })
    },
    update(params: { id: number; serverConfig: MCPServerConfig }) {
      const { id, serverConfig } = params

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
    getById(params: { id: number }) {
      const { id } = params

      return repo.getById(id)
    },
  }
}
