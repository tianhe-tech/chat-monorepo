import type { MCPServerConfig } from '@th-chat/shared/contracts/mcp-server-config'
import { errAsync } from 'neverthrow'
import { MCPServerConfigDuplicateError, type UserMCPServerConfigRepo } from '../../domain/port/repository'

export class DuplicateConfigError extends Error {}
export class NotFoundError extends Error {}

type Params = {
  repo: UserMCPServerConfigRepo
}

export function createMCPServerConfigUseCase({ repo }: Params) {
  const mapDuplicateError = (serverConfig: MCPServerConfig & { id?: number }) => (error: Error) => {
    if (error instanceof MCPServerConfigDuplicateError) {
      return new DuplicateConfigError(`Duplicate MCP Server Config: ${serverConfig.name}`)
    }
    return error
  }

  return {
    upsert(params: { serverConfig: MCPServerConfig & { id?: number } }) {
      const { serverConfig } = params

      if (serverConfig.id !== undefined) {
        const id = serverConfig.id
        return repo.getById(id).andThen((exists) => {
          if (!exists) {
            return errAsync(new NotFoundError(`MCP Server Config not found: ID ${id}`))
          }
          return repo.upsert(serverConfig).mapErr(mapDuplicateError(serverConfig))
        })
      }

      return repo.upsert(serverConfig).mapErr(mapDuplicateError(serverConfig))
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
    getMany() {
      return repo.getMany()
    },
    getById(params: { id: number }) {
      const { id } = params

      return repo.getById(id)
    },
  }
}
