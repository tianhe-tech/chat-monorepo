import { tv } from 'tailwind-variants'

const message = tv({
  slots: {
    base: 'group/message @container/message flex flex-col',
    text: 'text-base',
    reasoning: 'text-sm',
  },
  variants: {
    role: {
      user: {
        base: 'max-w-(--user-msg-width,70%) items-end rtl:items-start',
        text: 'bg-(--user-text-bg) whitespace-pre-wrap rounded-2xl px-4 py-1.5',
      },
      assistant: {
        base: 'max-w-(--assistant-msg-width,100%) items-start rtl:items-end',
        reasoning: 'text-(--assistant-reasoning-color)',
      },
    },
  },
})

export default message
