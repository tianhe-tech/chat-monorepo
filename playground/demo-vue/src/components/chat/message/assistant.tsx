import type { MyUIMessage } from '@/ai/types'
import Button from '@nuxt/ui/components/Button.vue'
import { message as messageUI } from '@repo/design/theme'
import { resolveElicitationRequest, type ResolveElicitationRequestReturn } from '@repo/shared/ai'
import { type DynamicToolUIPart, type ReasoningUIPart, type TextUIPart } from 'ai'
import { Fragment, type FunctionalComponent as FC } from 'vue'
import { ChatMarkdown } from '../markdown'
import { injectMessageContext } from './Root.vue'
import { injectChatContext } from '../Provider.vue'
import { UIPartBrands } from '@repo/shared/types'

export const ChatMessageAssistantParts: FC<{ parts: MyUIMessage['parts'] }> = ({ parts }) => {
  const { message } = injectMessageContext()

  return message.value.parts.map((part, index) => (
    <Fragment key={JSON.stringify(part)}>
      {(function () {
        switch (part.type) {
          case 'text':
            return <TextPart part={part} />
          case 'reasoning':
            return <ReasoningPart part={part} />
          case 'dynamic-tool':
            return <DynamicToolPart part={part} />
          default:
            return null
        }
      })()}
    </Fragment>
  ))
}

const ui = messageUI({ role: 'assistant' })

const TextPart: FC<{ part: TextUIPart }> = ({ part }) => (
  <div class={ui.text()}>
    <ChatMarkdown markdown={part.text} />
  </div>
)

const ReasoningPart: FC<{ part: ReasoningUIPart }> = ({ part }) => (
  <div class={ui.reasoning()}>
    <ChatMarkdown markdown={part.text} />
  </div>
)

const DynamicToolPart: FC<{ part: DynamicToolUIPart }> = ({ part }) => {
  const elicitationRequest = resolveElicitationRequest({ part })
  if (elicitationRequest.isOk()) {
    return <ElicitationRequestMCPToolPart part={part} resolved={elicitationRequest.value} />
  }

  console.error(elicitationRequest.error)

  return <DefaultMCPToolPart part={part} />
}

const DefaultMCPToolPart: FC<{ part: DynamicToolUIPart }> = ({ part }) => {
  return JSON.stringify({ part })
}

const ElicitationRequestMCPToolPart: FC<{ part: DynamicToolUIPart; resolved: ResolveElicitationRequestReturn }> = ({
  part,
  resolved,
}) => {
  const { chat } = injectChatContext()

  const { message, accept, cancel, decline } = resolved
  const { input, toolName } = part

  function onAccept() {
    const result = accept({})
    if (result.isErr()) {
      console.error(result.error)
      part.output = { [UIPartBrands.ElicitationResponse]: { action: 'cancel' } }
    } else {
      part.output = { [UIPartBrands.ElicitationResponse]: result.value }
    }
    chat.value.sendMessage()
  }
  function onDecline() {
    part.output = { [UIPartBrands.ElicitationResponse]: decline() }
    chat.value.sendMessage()
  }
  function onCancel() {
    part.output = { [UIPartBrands.ElicitationResponse]: cancel() }
    chat.value.sendMessage()
  }

  return (
    <div class='flex flex-col gap-4 bg-amber-100 p-4'>
      <div>{{ toolName }}</div>
      <div>Elicitation: {message}</div>
      <div class='flex gap-2'>
        <Button onClick={onAccept} variant='outline'>
          接受
        </Button>
        <Button onClick={onDecline} variant='outline'>
          拒绝
        </Button>
        <Button onClick={onCancel} variant='outline'>
          取消
        </Button>
      </div>
    </div>
  )
}
