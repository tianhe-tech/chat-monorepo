import { message as messageUI } from '@repo/design/theme'
import { Fragment, type FunctionalComponent as FC } from 'vue'
import { resolveElicitationRequest, type ResolveElicitationRequestReturn } from '@repo/shared/ai'
import {
  type DynamicToolUIPart,
  type ReasoningUIPart,
  type TextUIPart,
  type ToolUIPart,
  getToolOrDynamicToolName,
} from 'ai'
import { ChatMarkdown } from '../markdown'
import { injectChatContext } from '../Provider.vue'
import { injectMessageContext } from './Root.vue'
import type { MyUIMessage } from '@/ai/types'
import Button from '@nuxt/ui/components/Button.vue'

export const ChatMessageAssistantParts: FC<{ parts: MyUIMessage['parts'] }> = ({ parts }) => {
  return parts.map((part, index) => (
    <Fragment key={index}>
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

  return <DefaultMCPToolPart part={part} />
}

const DefaultMCPToolPart: FC<{ part: DynamicToolUIPart }> = ({ part }) => {}

const ElicitationRequestMCPToolPart: FC<{ part: DynamicToolUIPart; resolved: ResolveElicitationRequestReturn }> = ({
  part,
  resolved,
}) => {
  const { message, accept, cancel, decline } = resolved
  const { input, toolName } = part

  return (
    <div class='flex flex-col gap-4 bg-amber-100 p-4'>
      Elicitation: {message}
      <div class='flex gap-2'>
        <Button></Button>
      </div>
    </div>
  )
}
