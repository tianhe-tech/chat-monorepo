<script setup lang="ts">
  import { Chat } from '@ai-sdk/vue'
  import { createDeepSeek } from '@ai-sdk/deepseek'

  import { buildSimpleClientOnlyTransport } from '@th-chat/vue'
  import * as theme from '@th-chat/design/theme'

  const deepseekApiKey = import.meta.env.VITE_DEEPSEEK_API_KEY

  const provider = createDeepSeek({ apiKey: deepseekApiKey })

  const chat = new Chat({
    transport: buildSimpleClientOnlyTransport(provider.languageModel('deepseek-reasoner')),
  })

  const input = ref('')

  function onSubmit() {
    chat.sendMessage({ text: input.value.trim() })
    input.value = ''
  }

  const uiThread = theme.thread()
  const uiMessage = theme.message()
</script>

<template>
  <div :class="uiThread.base({ class: 'h-screen' })">
    <div :class="uiThread.body()">
      <template v-for="message in chat.messages" :key="message.id">
        <div v-if="message.role === 'assistant'" class="text-left">
          <template v-for="part in message.parts" :key="part.type">
            <div v-if="part.type === 'reasoning'" :class="uiMessage.reasoning({ role: 'assistant' })">
              {{ part.text }}
            </div>
            <div v-else-if="part.type === 'text'">
              {{ part.text }}
            </div>
          </template>
        </div>
        <div v-else-if="message.role === 'user'" :class="uiMessage.group({ role: 'user' })">
          <template v-for="part in message.parts" :key="part.type">
            <div v-if="part.type === 'text'" :class="uiMessage.text({ role: 'user' })">
              {{ part.text }}
            </div>
          </template>
        </div>
      </template>
    </div>

    <div :class="uiThread.bottom()">
      <div class="p-2">
        <textarea class="w-full border" v-model="input" @keydown.enter.exact="onSubmit" />
      </div>
    </div>
  </div>
</template>
