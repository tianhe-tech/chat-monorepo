import * as Contract from '@th-chat/shared/contracts/chat-mcp-hub'
import consola from 'consola'
import { err, ok, okAsync } from 'neverthrow'
import { DomainMediator } from '../../domain/mediator'
import { MCPHubService } from '../../domain/service/mcp-hub'
import { MCPClientImpl } from '../../infra/mcp-client'
import { DrizzleMCPServerConfigRepo } from '../../infra/mcp-server-config-repo'
import { ValkeyChatComm } from '../../infra/valkey-chat-comm'
import { env } from '../env'
import { getMCPHubCache, MCPHubCacheKeyRegistry } from '../service/mcp-hub-cache'

export class NotFoundError extends Error {}

export const createMCPHubUseCase = (props: { userId: string; scope: string; threadId: string }) => {
  const { userId, scope, threadId } = props
  const logger = consola.withTag(`[${threadId}] MCP Hub`)

  const repo = new DrizzleMCPServerConfigRepo({ userId, scope })
  const cacheKeyRegistry = new MCPHubCacheKeyRegistry({ userId, scope })
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
          logger: consola.withTag(`[${threadId}] Chat Comm`),
          valkeyAddresses: env.VALKEY_ADDRESSES,
        }).map((chatComm) => {
          const mcphub = new MCPHubService({
            id: threadId,
            servers: configs,
            logger: consola.withTag(`[${threadId}] MCP Hub Service`),
            mediator: domainMediator,
            mcpClientFactory: (config) =>
              new MCPClientImpl({
                config,
                logger: consola.withTag(`[${threadId}] MCP Client ${config.name}`),
              }),
          })

          mcphub.disposableStack.use(chatComm)
          mcphub.disposableStack.defer(() => void domainMediator.removeAllListeners())
          mcphubCache.set(threadId, mcphub)
          cacheKeyRegistry.register(threadId)
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
