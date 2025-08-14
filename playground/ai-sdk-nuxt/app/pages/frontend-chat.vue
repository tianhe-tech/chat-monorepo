<script setup lang="ts">
  import { Chat } from '@ai-sdk/vue'
  import { buildSimpleClientOnlyTransport } from '@chat-monorepo/vue'
  import { createDeepSeek } from '@ai-sdk/deepseek'

  const { deepseekApiKey } = useRuntimeConfig().public

  const provider = createDeepSeek({ apiKey: deepseekApiKey })

  const chat = new Chat({
    transport: buildSimpleClientOnlyTransport(provider.languageModel('deepseek-reasoner')),
  })

  const input = ref('')

  function onSubmit() {
    chat.sendMessage({ text: input.value.trim() })
    input.value = ''
  }
</script>

<template>
  <div class="flex h-screen flex-col">
    <div class="grow overflow-y-auto">
      <template v-for="message in chat.messages" :key="message.id">
        <div v-if="message.role === 'assistant'" class="text-left">
          <template v-for="part in message.parts" :key="part.type">
            <div v-if="part.type === 'reasoning'" class="bg-teal-100">
              {{ part.text }}
            </div>
            <div v-else-if="part.type === 'text'">
              {{ part.text }}
            </div>
          </template>
        </div>
        <div v-else-if="message.role === 'user'" class="text-right">
          <template v-for="part in message.parts" :key="part.type">
            <div v-if="part.type === 'text'">
              {{ part.text }}
            </div>
          </template>
        </div>
      </template>
    </div>

    <div class="p-2">
      <textarea class="w-full border" v-model="input" @keydown.enter.exact="onSubmit" />
    </div>
  </div>
</template>
