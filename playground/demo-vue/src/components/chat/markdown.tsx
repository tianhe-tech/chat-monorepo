import { VueMarkdown, type SanitizeOptions, type TVueMarkdown } from '@crazydos/vue-markdown'
import { MarkdownTableWrapper } from '@repo/design'
import { markdown as markdownUI } from '@repo/design/theme'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { FunctionalComponent } from 'vue'

const ui = markdownUI()

type VueMarkdownSlots = InstanceType<TVueMarkdown>['$slots']

export const ChatMarkdown: FunctionalComponent<{ markdown: string }> = ({ markdown }) => (
  <VueMarkdown
    markdown={markdown}
    sanitize={true}
    sanitizeOptions={sanitizeOptions}
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[rehypeKatex]}
  >
    {
      {
        h1: ({ children, ...attrs }) => (
          <h1 class={ui.h1()} {...attrs}>
            <children />
          </h1>
        ),
        h2: ({ children, ...attrs }) => (
          <h2 class={ui.h2()} {...attrs}>
            <children />
          </h2>
        ),
        h3: ({ children, ...attrs }) => (
          <h3 class={ui.h3()} {...attrs}>
            <children />
          </h3>
        ),
        h4: ({ children, ...attrs }) => (
          <h4 class={ui.h4()} {...attrs}>
            <children />
          </h4>
        ),
        p: ({ children, ...attrs }) => (
          <p class={ui.p()} {...attrs}>
            <children />
          </p>
        ),
        hr: ({ ...attrs }) => <hr class={ui.hr()} {...attrs} />,
        'inline-code': ({ children, ...attrs }) => (
          <code class={ui.inlineCode()} {...attrs}>
            <children />
          </code>
        ),
        li: ({ children, ...attrs }) => (
          <ul class={ui.li()} {...attrs}>
            <children />
          </ul>
        ),
        ol: ({ children, ...attrs }) => (
          <ol class={ui.ol()} {...attrs}>
            <children />
          </ol>
        ),
        ul: ({ children, ...attrs }) => (
          <ul class={ui.ul()} {...attrs}>
            <children />
          </ul>
        ),
        thead: ({ children, ...attrs }) => (
          <thead class={ui.thead()} {...attrs}>
            <children />
          </thead>
        ),
        tr: ({ children, ...attrs }) => (
          <tr class={ui.tr()} {...attrs}>
            <children />
          </tr>
        ),
        th: ({ children, ...attrs }) => (
          <th class={ui.th()} {...attrs}>
            <children />
          </th>
        ),
        td: ({ children, ...attrs }) => (
          <td class={ui.td()} {...attrs}>
            <children />
          </td>
        ),
        table: ({ children, ...attrs }) => (
          <MarkdownTableWrapper>
            <table class={ui.table()} {...attrs}>
              {children}
            </table>
          </MarkdownTableWrapper>
        ),
      } as VueMarkdownSlots
    }
  </VueMarkdown>
)

const sanitizeOptions: SanitizeOptions = {
  sanitizeOptions: {
    tagNames: [
      // Default allowed tags
      'a',
      'b',
      'blockquote',
      'br',
      'code',
      'dd',
      'del',
      'details',
      'div',
      'dl',
      'dt',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'i',
      'img',
      'li',
      'ol',
      'p',
      'pre',
      'span',
      'strong',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'ul',
      // KaTeX specific tags
      'math',
      'mrow',
      'msup',
      'msub',
      'mi',
      'mn',
      'mo',
      'mfrac',
      'msqrt',
      'mroot',
      'mtable',
      'mtr',
      'mtd',
      'mtext',
      'mspace',
      'menclose',
      'annotation',
    ],
    attributes: {
      '*': ['className', 'class', 'id', 'style'],
      span: ['className', 'class', 'style', 'title'],
      math: ['xmlns', 'display'],
      annotation: ['encoding'],
    },
  },
}
