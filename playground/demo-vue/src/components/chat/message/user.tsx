import { message as messageUI } from '@th-chat/design/theme'
import type { FunctionalComponent } from 'vue'

import { injectMessageContext } from './Root.vue'

export const ChatMessageUserParts: FunctionalComponent = () => {
  const { message } = injectMessageContext()

  return message.value.parts.map((part, index) => {
    switch (part.type) {
      case 'text':
        return <TextPart key={index} text={part.text} />
      default:
        return null
    }
  })
}

const ui = messageUI({ role: 'user' })

const TextPart: FunctionalComponent<{ text: string }> = ({ text }) => <div class={ui.text()}>{text}</div>
