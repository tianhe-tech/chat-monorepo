import consola from 'consola'
import { DrizzleMCPServerConfigRepo } from '../../infra/mcp-server-config-repo'
import { getMCPHubCache, MCPHubCacheKeyRegistry } from '../service/mcp-hub-cache'
import { err, errAsync, ok, okAsync } from 'neverthrow'
import { ValkeyChatComm } from '../../infra/valkey-chat-comm'
import { domainMediator } from '../utils'
import { env } from '../env'
import { MCPHubService } from '../../domain/service/mcp-hub'
import { MCPClientImpl } from '../../infra/mcp-client'
import * as Contract from '@internal/shared/contracts/chat-mcp-hub'

export class NotFoundError extends Error {}

export const createMCPHubUseCase = (props: { userId: string; scope: string; threadId: string }) => {
  const { userId, scope, threadId } = props
  const logger = consola.withTag(`[${threadId}] MCP Hub`)

  const repo = new DrizzleMCPServerConfigRepo({ userId, scope })
  const cacheKeyRegistry = new MCPHubCacheKeyRegistry({ userId, scope })
  const mcphubCache = getMCPHubCache()

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
          return err(new NotFoundError(`No MCP Server config found for user(${userId}) with scope(${scope})`))
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

          mcphub.useDisposable(chatComm)
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
