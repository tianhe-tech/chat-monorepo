import type { MCPHubAPI } from '../port/mcp-hub-api'
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js'
import { dynamicTool, jsonSchema, type Tool as AITool } from 'ai'
import z from 'zod'
import { MCPToolPartTag } from '../entity/part'

type CtorParams = {
  hubAPI: MCPHubAPI
  signal?: AbortSignal
}

export class MCPToolService {
  #hubAPI: CtorParams['hubAPI']
  #currentToolCallId?: string
  #signal?: AbortSignal

  constructor({ hubAPI, signal }: CtorParams) {
    this.#hubAPI = hubAPI
    this.#signal = signal
  }

  #convertMCPToolToAITool(mcpTool: MCPTool): [string, AITool] {
    const inputSchemaWithIntent: Record<string, unknown> = {
      type: 'object',
      properties: {
        ...z.toJSONSchema(z.object({ [MCPToolPartTag.intent]: z.string().describe('简要描述使用该工具的目的') }))
          .properties,
        params: mcpTool.inputSchema,
      },
    }

    return [
      mcpTool.name,
      {
        ...dynamicTool({
          inputSchema: jsonSchema(inputSchemaWithIntent),
          description: mcpTool.description,
          execute: async (input, { toolCallId }) => {
            const prevToolCallId = this.#currentToolCallId
            this.#currentToolCallId = toolCallId
            using ds = new DisposableStack()
            ds.defer(() => {
              this.#currentToolCallId = prevToolCallId
            })

            const params = (input as any)?.params
            const result = await this.#hubAPI.callTool(
              {
                name: mcpTool.name,
                arguments: params,
                _meta: {
                  progressToken: toolCallId,
                },
              },
              { signal: this.#signal },
            )

            if (result.isErr()) {
              throw result.error
            }

            return result.value.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
          },
        }),
      },
    ]
  }

  listAllTools() {
    return this.#hubAPI
      .listAllTools({ signal: this.#signal })
      .map((tools) => tools.map((tool) => this.#convertMCPToolToAITool(tool)))
  }
}
