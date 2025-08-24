import type { MastraMCPServerDefinition } from '@mastra/mcp'

export function builtinMcpServers(requestInit?: RequestInit) {
  return {
    demo: {
      url: new URL('http://localhost:8000/mcp'),
      requestInit,
    },
  } as const satisfies Record<string, MastraMCPServerDefinition>
}
