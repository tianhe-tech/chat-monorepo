<script lang="ts">
  import type { MyUIMessage } from '@/ai/types'
  import type { Chat } from '@ai-sdk/vue'

  const injectionKey = Symbol('chat-provider') as InjectionKey<{ chat: Readonly<Ref<Chat<MyUIMessage>>> }>
  export function injectChatContext() {
    const context = inject(injectionKey)
    if (!context) {
      throw new Error('Chat context not found, make sure to wrap your component with <ChatProvider />')
    }
    return context
  }
</script>

<script setup lang="ts">
  import type { InjectionKey } from 'vue'

  const { chat } = defineProps<{
    chat: Chat<MyUIMessage>
  }>()

  provide(injectionKey, { chat: computed(() => chat) })
</script>

<template>
  <slot />
</template>
