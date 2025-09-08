import { tv } from 'tailwind-variants'

const markdown = tv({
  slots: {
    p: 'my-2 leading-7 first:mt-0 last:mb-0',
    a: 'text-(--color-primary,var(--color-blue-300)) p-0',
    h1: 'my-4 text-3xl font-extrabold tracking-tight lg:text-4xl',
    h2: 'mb-3 mt-4 text-2xl font-bold tracking-tight',
    h3: 'mb-2 mt-4 text-xl font-semibold tracking-tight',
    h4: 'my-2 text-lg font-medium tracking-tight',
    hr: 'border-separator my-8 border-b',
    inlineCode:
      'bg-black/6 mx-[0.1rem] inline max-w-full break-all rounded px-[0.3rem] py-[0.2rem] font-mono text-sm font-medium',
    li: 'my-2',
    ol: 'mb-4 list-decimal pl-6',
    ul: 'mb-4 list-disc pl-6',
    /**
     * This is for the actual `<table>` element, which should be wrapped in a scroll container.
     */
    table: 'min-w-max text-sm',
    thead: 'border-b',
    th: 'px-4 py-3 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right',
    td: 'max-w-(--table-cell-width,600px) px-4 py-3 text-left [&[align=center]]:text-center [&[align=right]]:text-right',
    tr: 'not-first:border-t',
  },
})

export default markdown
