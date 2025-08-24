import { hc } from 'hono/client'

import type { AppType } from './index.ts'

const client = hc<AppType>('')

export default client
