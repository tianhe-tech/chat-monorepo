import { Markdown } from '@repo/design/components/markdown'
import type { FunctionalComponent } from 'vue'

export const ChatMarkdown: FunctionalComponent<{ markdown: string }> = ({ markdown }) => (
  <Markdown markdown={markdown} />
)
