import { tv } from 'tailwind-variants'

const thread = tv({
  slots: {
    base: 'group/thread @container/thread flex flex-col overflow-hidden focus-visible:outline-0',
    body: 'relative grow overflow-y-auto',
    bottom: 'relative isolate z-10 w-full shrink-0',
  },
})

export default thread
