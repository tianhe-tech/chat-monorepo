<script lang="ts">
  import type { UIMessage } from 'ai'

  const messageInjectionKey = Symbol('__message') as InjectionKey<{ message: UIMessage }>

  export function injectMessageContext() {
    const context = inject(messageInjectionKey)
    if (!context) {
      throw new Error('Message context is not provided.')
    }
    return context
  }

  export type MessageContainerProps = PrimitiveProps & {
    message: UIMessage
  }
</script>

<script setup lang="ts">
  import { Primitive, type PrimitiveProps } from 'reka-ui'
  import { inject, provide, useAttrs, type InjectionKey } from 'vue'
  import _ui from './ui'

  const { message, ...props } = defineProps<MessageContainerProps>()
  const { class: className, ...attrs } = useAttrs() as any
  provide(messageInjectionKey, { message })

  const ui = _ui()
</script>

<template>
  <Primitive v-bind="{ ...props, ...attrs }" :class="ui.container({ className })">
    <slot />
  </Primitive>
</template>
