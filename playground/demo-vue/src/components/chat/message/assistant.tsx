import { message as messageUI } from '@repo/design/theme'
import type { FunctionalComponent } from 'vue'

import type { Tools } from '@repo/shared/ai'
import { type DynamicToolUIPart, type ToolUIPart, getToolOrDynamicToolName } from 'ai'
import { ChatMarkdown } from '../markdown'
import { injectChatContext } from '../Provider.vue'
import { injectMessageContext } from './Root.vue'

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
        return null
      case 'dynamic-tool':
        if (part.state === 'input-streaming') {
          return null
        }
        return (
          <WithConfirmation key={index} part={part}>
            {
              {
                default: ({ isNeedingConfirm, accept, decline }) => (
                  <div class='border bg-amber-100 p-3'>
                    <div class='text-lg'>工具: {getToolOrDynamicToolName(part)}</div>
                    {isNeedingConfirm ? (
                      <>
                        <div class='whitespace-pre-wrap'>输入 {JSON.stringify(part.input, null, 2)}</div>
                        <div class='flex gap-2'>
                          <button onClick={accept}>accept</button>
                          <button onClick={decline}>decline</button>
                        </div>
                      </>
                    ) : (
                      <div class='whitespace-pre-wrap'>输出 {JSON.stringify(part.output, null, 2)}</div>
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

const WithConfirmation: FunctionalComponent<
  { part: ToolUIPart<Tools> | DynamicToolUIPart },
  {},
  WithConfirmationSlots
> = ({ part }, { slots }) => {
  const { chat } = injectChatContext()

  const isNeedingConfirm = chat.value.status === 'ready' && part.state === 'input-available'

  async function resubmitWith(_confirm: 'accept' | 'decline' | 'cancel') {
    // @ts-ignore
    part.input = { ...part.input, _confirm }
    // await chat.value.addToolResult({ tool: getToolName(part), toolCallId: part.toolCallId, output: { _confirm } })

    chat.value.sendMessage()
  }

  return slots.default?.({
    isNeedingConfirm,
    accept: () => resubmitWith('accept'),
    decline: () => resubmitWith('decline'),
    cancel: () => resubmitWith('cancel'),
  })
}
