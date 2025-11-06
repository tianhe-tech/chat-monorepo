import * as Contract from '@th-chat/shared/contracts/chat-mcp-hub'
import consola from 'consola'
import { err, ok, okAsync } from 'neverthrow'
import { DomainMediator } from '../../domain/mediator'
import { MCPHubService } from '../../domain/service/mcp-hub'
import { MCPClientImpl } from '../../infra/mcp-client'
import { ValkeyChatComm } from '../../infra/valkey-chat-comm'
import { env } from '../env'
import { getMCPHubCache, MCPHubCacheKeyRegistry } from '../service/mcp-hub-cache'
import type { UserMCPServerConfigRepo } from '../../domain/port/repository'

export class NotFoundError extends Error {}

type Params = {
  repo: UserMCPServerConfigRepo
  mcpHubCacheKeyRegistry: MCPHubCacheKeyRegistry
  threadId: string
}

export const createMCPHubUseCase = ({ repo, mcpHubCacheKeyRegistry, threadId }: Params) => {
  const logger = consola.withTag(`MCPHub:${threadId}`)

  const mcphubCache = getMCPHubCache()
  const domainMediator = new DomainMediator()

  const getHub = () => {
    const existingHub = mcphubCache.get(threadId)
    if (existingHub) {
      logger.debug('Cache hit')
      return okAsync(existingHub)
    }

    return repo
      .getMany()
      .andThrough((configs) => {
        if (configs.length === 0) {
          return err(new NotFoundError(`No MCP Server config found`))
        }
        return ok()
      })
      .andThen((configs) =>
        ValkeyChatComm.create({
          mediator: domainMediator,
          logger: consola.withTag(`ChatComm:${threadId}`),
          valkeyAddresses: env.VALKEY_ADDRESSES,
        }).map((chatComm) => {
          const mcphub = new MCPHubService({
            id: threadId,
            servers: configs,
            logger: consola.withTag(`MCPHubService:${threadId}`),
            mediator: domainMediator,
            mcpClientFactory: (config) =>
              new MCPClientImpl({
                config,
                logger: consola.withTag(`MCPClient:${config.name}`),
              }),
          })

          mcphub.disposableStack.use(chatComm)
          mcphub.disposableStack.defer(() => void domainMediator.removeAllListeners())
          mcphubCache.set(threadId, mcphub)
          mcpHubCacheKeyRegistry.register(threadId)
          return mcphub
        }),
      )
  }

  return getHub().map((hub) => ({
    listTools() {
      return hub.listAllTools()
    },
    callTool(params: Contract.ToolCallRequest['data']) {
      const { toolCallId, ...toolCallParams } = params
      return hub.callTool(toolCallId, toolCallParams)
    },
  }))
}
