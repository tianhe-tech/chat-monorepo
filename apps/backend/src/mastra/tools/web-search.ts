import { createTool } from '@mastra/core'
import { z } from 'zod'
import { ofetch } from 'ofetch'

import { env } from '../../env.ts'

export const webSearch = createTool({
  id: 'web-search',
  description: `Search the web and get enhanced search details from billions of web documents, including page titles, urls, summaries, site names, site icons, publication dates, image links, and more.`,
  inputSchema: z.object({
    query: z.string().describe('Search Query'),
    freshness: z
      .string()
      .optional()
      .describe(
        `The time range for the search results. (Available options YYYY-MM-DD, YYYY-MM-DD..YYYY-MM-DD, noLimit, oneYear, oneMonth, oneWeek, oneDay. Default is noLimit)`,
      ),
    count: z.number().int().optional().describe('Number of results (1-50, default 10)'),
  }),
  async execute({ context }) {
    const { query, count, freshness } = context
    const { data } = await ofetch<{
      data: {
        webPages: {
          value: WebPageResult[]
        }
      }
    }>('https://api.bochaai.com/v1/web-search', {
      method: 'post',
      headers: {
        Authorization: `Bearer ${env.BOCHA_API_KEY}`,
      },
      body: {
        query,
        count,
        freshness,
        summary: true,
      },
    })

    return data.webPages.value
  },
})

interface WebPageResult {
  cachedPageUrl: string | null
  dateLastCrawled: string
  datePublished: string
  displayUrl: string
  id: string
  isFamilyFriendly: boolean | null
  isNavigational: boolean | null
  language: string | null
  name: string
  siteIcon: string
  siteName: string
  snippet: string
  url: string
}
