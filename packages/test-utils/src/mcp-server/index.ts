import exitHook from 'exit-hook'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { resolve } from 'node:path'

type SpinUpFixtureMCPServerOptions = {
  port: number
}

async function waitForPortReady(port: number, host: string, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ port, host }, () => {
          socket.end()
          resolve()
        })
        socket.on('error', (error) => {
          socket.destroy()
          reject(error)
        })
      })
      return
    } catch {
      await delay(100)
    }
  }
  throw new Error(`Timed out waiting for ${host}:${port} to become ready`)
}

export async function spinUpFixtureMCPServer({ port }: SpinUpFixtureMCPServerOptions) {
  console.debug('cwd', import.meta.dirname)

  const server = spawn('uv', ['run', 'mcp-server'], {
    cwd: resolve(import.meta.dirname),
    env: {
      ...process.env,
      MCP_SERVER_PORT: String(port),
      MCP_SERVER_HOST: 'localhost',
    },
  })

  server.on('error', (err) => {
    console.error('Failed to start MCP server process:', err)
  })
  server.stdout?.pipe(process.stdout)
  server.stderr?.pipe(process.stderr)

  function teardown() {
    if (!server.killed) {
      server.kill('SIGINT')
    }
  }

  exitHook(teardown)

  await waitForPortReady(port, 'localhost')

  return {
    teardown,
  }
}
