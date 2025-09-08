import { message as messageUI } from '@th-chat/design/theme'
import type { FunctionalComponent } from 'vue'

import { injectMessageContext } from './Root.vue'
import { ChatMarkdown } from '../markdown'
import { injectChatContext } from '../Provider.vue'
import type { Tools } from '@th-chat/shared'
import { type ToolUIPart, getToolName } from 'ai'
import type { MyUIMessage } from '@/types/ai'

export const ChatMessageAssistantParts: FunctionalComponent = () => {
  const { message } = injectMessageContext()

  const { parts } = message.value

  return parts.map((part, index) => {
    switch (part.type) {
      case 'text':
        return <TextPart key={index} text={part.text} />
      case 'reasoning':
        return <ReasoningPart key={index} text={part.text} />
      default:
        if (!part.type.includes('tool')) {
          return null
        }

        if (part.state === 'input-streaming') {
          return null
        }

        return (
          <WithConfirmation key={index} part={part}>
            {
              {
                default: ({ isNeedingConfirm, accept, decline }) => (
                  <div class='bg-amber-100'>
                    <div class='text-lg'>工具: {getToolName(part)}</div>
                    {isNeedingConfirm ? (
                      <div class='flex gap-2'>
                        <button onClick={accept}>accept</button>
                        <button onClick={decline}>decline</button>
                      </div>
                    ) : (
                      JSON.stringify(part.output)
                    )}
                  </div>
                ),
              } as WithConfirmationSlots
            }
          </WithConfirmation>
        )
    }
  })
}

const ui = messageUI({ role: 'assistant' })

const TextPart: FunctionalComponent<{ text: string }> = ({ text }) => (
  <div class={ui.text()}>
    <ChatMarkdown markdown={text} />
  </div>
)

const ReasoningPart: FunctionalComponent<{ text: string }> = ({ text }) => (
  <div class={ui.reasoning()}>
    <ChatMarkdown markdown={text} />
  </div>
)

type WithConfirmationSlots = {
  default(props: { accept(): void; decline(): void; cancel(): void; isNeedingConfirm: boolean }): any
}

const WithConfirmation: FunctionalComponent<{ part: ToolUIPart<Tools> }, {}, WithConfirmationSlots> = (
  { part },
  { slots },
) => {
  const { chat } = injectChatContext()

  const isNeedingConfirm = chat.value.status === 'ready' && part.state === 'input-available'

  async function resubmitWith(_confirm: 'accept' | 'decline' | 'cancel') {
    // @ts-ignore
    part.input = { ...part.input, _confirm }
    // await chat.value.addToolResult({ tool: getToolName(part), toolCallId: part.toolCallId, output: { _confirm } })

    chat.value.sendMessage()
  }

  return (
    slots.default?.({
      isNeedingConfirm,
      accept: () => resubmitWith('accept'),
      decline: () => resubmitWith('decline'),
      cancel: () => resubmitWith('cancel'),
    }) ?? null
  )
}
