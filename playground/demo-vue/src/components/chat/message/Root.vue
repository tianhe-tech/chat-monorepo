<script lang="ts">
  import type { MyUIMessage } from '@/types/ai'

  const injectionKey = Symbol('ChatMessageRoot') as InjectionKey<{
    message: Readonly<Ref<MyUIMessage>>
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
  import { message as messageUI } from '@th-chat/design/theme'

  const { message } = defineProps<{
    message: MyUIMessage
  }>()

  const ui = messageUI()

  provide(injectionKey, {
    message: computed(() => message),
  })
</script>

<template>
  <div :class="ui.group({ role: message.role })">
    <slot />
  </div>
</template>
