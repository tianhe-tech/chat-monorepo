import ky from 'ky'
import { env } from '../env'

export const mcpFetcher = ky.create({
  prefixUrl: env.MCP_SERVICE_URL,
})
