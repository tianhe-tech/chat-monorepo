<script setup lang="ts">
  import { ChatMessageAssistantParts } from '@/components/chat/message/assistant'
  import { ChatMessageUserParts } from '@/components/chat/message/user'
  import type { MyUIMessage } from '@/types/ai'
  import { Chat } from '@ai-sdk/vue'
  import * as theme from '@th-chat/design/theme'
  import { DefaultChatTransport } from 'ai'

  const ui = {
    thread: theme.thread(),
    message: theme.message(),
  }

  const chat = new Chat<MyUIMessage>({
    transport: new DefaultChatTransport({ api: '/api/chat/mcp-test' }),
  })

  const inputValue = ref('')

  function sendMessage() {
    chat.sendMessage({ text: inputValue.value })
    inputValue.value = ''
  }
</script>

<template>
  <ChatProvider :chat="chat">
    <div :class="ui.thread.base({ class: 'h-screen' })">
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
