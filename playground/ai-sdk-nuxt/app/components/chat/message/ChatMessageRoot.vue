<script lang="ts">
  import type { UIMessage } from 'ai'

  const injectionKey = Symbol('ChatMessageRoot') as InjectionKey<{
    message: UIMessage
  }>
  export function injectMessageContext() {
    const context = inject(injectionKey)
    if (!context) {
      throw new Error('Message context is not provided')
    }
    return context
  }
</script>

<script setup lang="ts">
  import theme from '@chat-monorepo/design/theme'

  const { message, class: className } = defineProps<{
    message: UIMessage
    class?: any
  }>()

  const ui = theme.message()

  provide(injectionKey, {
    message,
  })
</script>

<template>
  <div :class="ui.base({ role: message.role, className })">
    <slot />
  </div>
</template>
