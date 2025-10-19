<script setup lang="ts">
  import { resolveElicitationRequest } from '@repo/shared/ai'
  import type { DynamicToolUIPart } from 'ai'
  import ElicitationRequestMCPToolPart from './ElicitationRequestMCPToolPart.vue'
  import DefaultMCPToolPart from './DefaultMCPToolPart.vue'

  const { part } = defineProps<{ part: DynamicToolUIPart }>()
  const elicitationRequest = computed(() => resolveElicitationRequest({ part }))
  watchEffect(() => {
    console.log('tool part', part.state)
  })
</script>

<template>
  <ElicitationRequestMCPToolPart v-if="elicitationRequest.isOk()" :part="part" :resolved="elicitationRequest.value" />
</template>
