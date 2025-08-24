<script setup lang="ts">
  import theme from '@chat-monorepo/design/theme'

  const ui = theme.message({ role: 'user' })
  const { text } = defineProps<{ text: string }>()
</script>

<template>
  <div :class="ui.text()">
    {{ text }}
  </div>
</template>
