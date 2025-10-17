<script setup lang="ts">
  import { Primitive, type PrimitiveProps } from 'reka-ui'
  import { twMerge } from 'tailwind-merge'
  import { useAttrs } from 'vue'
  import { injectMessageContext } from './MessageContainer.vue'
  import _ui from './ui'

  const props = defineProps<PrimitiveProps>()
  const { message } = injectMessageContext()
  const { class: className, ...attrs } = useAttrs() as any

  const ui = _ui({ role: message.role })
</script>

<template>
  <Primitive v-bind="{ ...props, ...attrs }" :class="twMerge(ui.parts(), className)">
    <slot />
  </Primitive>
</template>
