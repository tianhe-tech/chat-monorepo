<script setup lang="ts">
  import { Primitive, type PrimitiveProps } from 'reka-ui'
  import { useAttrs, useTemplateRef } from 'vue'
  import _ui from './ui'
  import { useAutoScroll } from '@/composables/use-autoscroll'

  const props = defineProps<PrimitiveProps>()
  const { class: className, ...attrs } = useAttrs() as any

  const ui = _ui()

  const threadBody = useTemplateRef('threadBody')
  useAutoScroll(() => threadBody.value?.$el)
</script>

<template>
  <Primitive v-bind="{ ...props, ...attrs }" :class="ui.body({ className })" ref="threadBody">
    <slot />
  </Primitive>
</template>
