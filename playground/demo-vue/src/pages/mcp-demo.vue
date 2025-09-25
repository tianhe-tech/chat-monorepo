<script setup lang="ts">
  import { ChatMessageAssistantParts } from '@/components/chat/message/assistant'
  import { ChatMessageUserParts } from '@/components/chat/message/user'
  import type { MyUIMessage } from '@/ai/types'
  import { Chat } from '@ai-sdk/vue'
  import * as theme from '@repo/design/theme'
  import { DefaultChatTransport } from 'ai'
  import { v4 as uuid } from 'uuid'

  const ui = {
    thread: theme.thread(),
    message: theme.message(),
  }

  const id = ref(uuid())

  const chat = computed(
    () =>
      new Chat<MyUIMessage>({
        id: id.value,
        transport: new DefaultChatTransport({
          api: '/api/chat',
          prepareSendMessagesRequest: ({ body, messages }) => ({
            body: {
              ...body,
              messages: [messages.at(-1)],
              threadId: id.value,
            },
          }),
        }),
      }),
  )

  const inputValue = ref('')

  function sendMessage() {
    chat.value.sendMessage({ text: inputValue.value })
    inputValue.value = ''
  }
</script>

<template>
  <ChatProvider :chat="chat">
    <div :class="ui.thread.base({ class: 'h-screen' })">
      <div class="flex items-center justify-center gap-8">
        Thread ID: {{ id }}
        <UButton size="sm" @click="id = uuid()"> New Chat </UButton>
      </div>
      <div :class="ui.thread.body({ class: 'p-5' })">
        <div v-for="message in chat.messages" :key="message.id" :class="ui.message.container({ role: message.role })">
          <ChatMessageRoot :message="message">
            <ChatMessageAssistantParts v-if="message.role === 'assistant'" />
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
