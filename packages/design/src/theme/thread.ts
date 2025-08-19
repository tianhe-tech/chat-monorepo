import { tv } from 'tailwind-variants'

const thread = tv({
  slots: {
    base: 'group/thread @container/thread flex flex-col overflow-hidden focus-visible:outline-0',
    content: 'relative grow overflow-y-auto',
    bottom: 'isoltate relative z-10 w-full',
  },
})

export default thread
