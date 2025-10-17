<script setup lang="ts">
  import { Primitive, type PrimitiveProps } from 'reka-ui'
  import { useAttrs } from 'vue'
  import { twMerge } from 'tailwind-merge'
  import _ui from './ui'
  import { injectMessageContext } from './MessageContainer.vue'

  const props = defineProps<PrimitiveProps>()
  const { message } = injectMessageContext()
  const { class: className, ...attrs } = useAttrs() as any

  const ui = _ui({ role: message.role })
</script>

<template>
  <Primitive v-bind="{ ...props, ...attrs }" :class="twMerge(ui.text(), className)">
    <slot />
  </Primitive>
</template>
