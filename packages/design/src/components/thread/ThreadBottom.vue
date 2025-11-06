<script setup lang="ts">
  import { Primitive, type PrimitiveProps } from 'reka-ui'
  import { useAttrs } from 'vue'
  import _ui from './ui'

  const props = defineProps<PrimitiveProps>()
  const { class: className, ...attrs } = useAttrs() as any

  const ui = _ui()
</script>

<template>
  <Primitive v-bind="{ ...props, ...attrs }" :class="ui.bottom({ className })">
    <slot />
  </Primitive>
</template>
