import { tv } from 'tailwind-variants'

const message = tv({
  slots: {
    container: '@container/message py-5',
    group: 'group/message flex flex-col',
    text: 'text-base',
    reasoning: 'text-sm',
  },
  variants: {
    role: {
      user: {
        group: 'items-end rtl:items-start',
        text: 'bg-(--user-text-bg) max-w-[70%] whitespace-pre-wrap rounded-2xl px-4 py-1.5',
      },
      assistant: {
        group: 'items-start rtl:items-end',
        reasoning: 'text-(--assistant-reasoning-color)',
      },
      system: {},
    },
  },
})

export default message
