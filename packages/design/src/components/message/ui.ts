import { tv } from 'tailwind-variants'

export default tv({
  slots: {
    container: '@container/message py-5',
    parts: 'group/message flex flex-col',
    text: 'text-base',
    reasoning: 'text-sm',
  },
  variants: {
    role: {
      user: {
        parts: 'items-end rtl:items-start',
        text: 'max-w-[70%] whitespace-pre-wrap rounded-2xl bg-gray-200 px-4 py-1.5',
      },
      assistant: {
        parts: 'items-start rtl:items-end',
        reasoning: 'border-l-2 pl-4 text-gray-500',
      },
      system: {},
    },
  },
})
