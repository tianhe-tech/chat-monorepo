<script lang="ts">
  const progressMessageInjectionKey = Symbol('progress-message') as InjectionKey<{
    progressMessage: Ref<string | undefined>
  }>

  export function injectProgressMessageContext() {
    const context = inject(progressMessageInjectionKey)
    if (!context) {
      throw new Error('Progress message context is not provided')
    }
    return context
  }
</script>

<script setup lang="ts">
  import ChatMessageAssistantParts from '@/components/chat/message/assistant/index.vue'
  import { ChatMessageUserParts } from '@/components/chat/message/user'
  import type { MyUIMessage } from '@/ai/types'
  import { Chat } from '@ai-sdk/vue'
  import * as theme from '@repo/design/theme'
  import { DefaultChatTransport } from 'ai'
  import { v4 as uuid } from 'uuid'
  import type { InjectionKey } from 'vue'
  import { getToolCallIntent } from '@internal/shared/types'

  const ui = {
    thread: theme.thread(),
    message: theme.message(),
  }

  const id = ref(uuid())

  const progressMessage = ref<string>()
  provide(progressMessageInjectionKey, { progressMessage })

  const chat = computed(
    () =>
      new Chat<MyUIMessage>({
        id: id.value,
        transport: new DefaultChatTransport({
          api: '/api/chats',
          prepareSendMessagesRequest: ({ body, messages }) => ({
            body: {
              ...body,
              messages: [messages.at(-1)],
              threadId: id.value,
            },
          }),
        }),
        onToolCall({ toolCall }) {
          const intent = getToolCallIntent(toolCall.input)
          if (intent) {
            progressMessage.value = intent
          }
        },
        onData({ type, data }) {
          if (type === 'data-progress' && data.message) {
            progressMessage.value = data.message
          }
        },
      }),
  )

  const inputValue = ref('')

  function sendMessage() {
    chat.value.sendMessage({ text: inputValue.value })
    console.log(chat.value.messages)
    inputValue.value = ''
  }
</script>

<template>
  <ChatProvider :chat="chat">
    <div :class="ui.thread.container({ class: 'h-screen' })">
      <div class="flex items-center justify-center gap-8">
        Thread ID: {{ id }}
        <UButton size="sm" @click="id = uuid()"> New Chat </UButton>
      </div>
      <div :class="ui.thread.body({ class: 'p-5' })">
        <div
          v-for="(message, index) in chat.messages"
          :key="message.id ? message.id : index"
          :class="ui.message.container({ role: message.role })"
        >
          <ChatMessageRoot :message="message">
            <template v-if="message.role === 'assistant'">
              <div v-if="progressMessage" class="animate-pulse">{{ progressMessage }}</div>
              <ChatMessageAssistantParts />
            </template>
            <ChatMessageUserParts v-else-if="message.role === 'user'" />
          </ChatMessageRoot>
        </div>
      </div>

      <div :class="ui.thread.bottom({ class: 'p-5' })">
        <UTextarea
          placeholder="Type your message here..."
          :maxrows="9"
          :rows="3"
          autoresize
          v-model="inputValue"
          :ui="{ root: 'w-full shadow-lg', trailing: 'items-end' }"
          @keydown.meta.enter.exact="sendMessage"
        >
          <template #trailing>
            <UButton @click="sendMessage">Send</UButton>
          </template>
        </UTextarea>
      </div>
    </div>
  </ChatProvider>
</template>
