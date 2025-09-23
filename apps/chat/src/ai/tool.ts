import type { ToolConfirmInput } from '@repo/shared/ai'
import {
  tool,
  type JSONValue,
  type Tool as AITool,
  type ToolCallOptions,
  type ToolExecuteFunction,
  dynamicTool,
  jsonSchema,
} from 'ai'
import type { AIStreamContext } from './types'
import type { CallToolRequest, CallToolResult, Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js'
import { ofetch } from 'ofetch'
import { env } from '../env'
import assert from 'node:assert'
import { useChatALS } from '../context/chat-als'

export function toolWithConfirm<
  INPUT extends JSONValue | unknown | never = any,
  OUTPUT extends JSONValue | unknown | never = any,
>(
  toolDef: AITool<INPUT, OUTPUT> & { execute: ToolExecuteFunction<INPUT, OUTPUT> },
  options: {
    onDecline?: (input: INPUT, options?: ToolCallOptions) => any
    onCancel?: (input: INPUT, options?: ToolCallOptions) => void
  } = {},
) {
  const originalExecute = toolDef.execute
  if (!originalExecute) {
    throw new Error('Tool with confirmation must have an execute function')
  }

  const { onCancel, onDecline } = options

  return tool({
    ...toolDef,
    execute: async (
      { _confirm, ...input }: ToolConfirmInput = {},
      { experimental_context: context = {}, ...options },
    ) => {
      const { abort, writer } = context as AIStreamContext
      if (!abort) {
        throw new Error('Tool with confirmation must have abort function in context')
      }
      if (!_confirm) {
        writer?.write({
          type: 'data-aborted-tool',
          transient: false,
          id: `aborted-${options.toolCallId}`,
          data: {
            abortReason: 'intercept',
            toolCallId: options.toolCallId,
            toolType: 'builtin',
          },
        })
        abort()
        return
      }

      switch (_confirm) {
        case 'accept':
          return originalExecute(input as any, { experimental_context: context, ...options })
        case 'decline':
          return onDecline
            ? onDecline(input as any, { experimental_context: context, ...options })
            : 'User declined to proceed.'
        case 'cancel':
          onCancel?.(input as any, { experimental_context: context, ...options })
          return abort()
        default:
          return
      }
    },
  })
}

export function convertMCPToolToAITool(
  mcpTool: MCPTool,
): [string, ReturnType<typeof dynamicTool> & { isEntry?: boolean }] {
  return [
    mcpTool.name,
    {
      isEntry: mcpTool._meta?.isEntry as boolean,
      ...dynamicTool({
        inputSchema: jsonSchema(mcpTool.inputSchema as any),
        description: mcpTool.description,
        execute: async (input, { abortSignal, toolCallId }) => {
          const als = useChatALS()
          als.currentToolCallId = toolCallId

          console.debug(`Calling MCP Tool ${mcpTool.name}...`)
          const { isError, content } = await ofetch<CallToolResult>('/tools', {
            baseURL: env.MCP_SERVICE_URL,
            method: 'POST',
            headers: {
              'mcp-thread-id': als.threadId,
            },
            body: {
              name: mcpTool.name,
              arguments: input,
              _meta: {
                progressToken: toolCallId,
              },
            } as CallToolRequest['params'],
            signal: abortSignal,
          })
          console.debug(`MCP Tool ${mcpTool.name} call finished.`)

          const result = content.map((c) => {
            assert.ok(c.type === 'text')
            return c.text
          })

          if (isError) {
            console.error(`MCP Tool ${mcpTool.name} execution failed:`, { result })
            throw new Error(`Tool ${mcpTool.name} execution failed.`)
          }

          return result
        },
      }),
    },
  ]
}
