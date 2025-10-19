<script setup lang="ts">
  import type { DynamicToolUIPart } from 'ai'
  import { isElicitationResponse } from '@repo/shared/types'

  const { part } = defineProps<{ part: DynamicToolUIPart }>()
</script>

<template>
  <div
    v-if="part.state === 'input-available' || part.state === 'input-streaming' || isElicitationResponse(part.output)"
    class="animate-pulse"
  >
    {{ part.input?.__intent }}
  </div>
</template>
