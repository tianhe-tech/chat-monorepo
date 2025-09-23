import { hc } from 'hono/client'
import type { AppType } from '.'

const honoClient = hc<AppType>('')
export default honoClient
