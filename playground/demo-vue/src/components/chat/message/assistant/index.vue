<script setup lang="ts">
  import { message as messageUI } from '@repo/design/theme'
  import { ChatMarkdown } from '../../markdown'
  import { injectMessageContext } from '../Root.vue'
  import DynamicToolPart from './DynamicToolPart.vue'

  const { message } = injectMessageContext()

  const ui = messageUI({ role: 'assistant' })
</script>

<template>
  <template v-for="(part, index) in message.parts" :key="`${message.id}-${part.type}-${index}-${part.state}`">
    <div v-if="part.type === 'text'" :class="ui.text()">
      <ChatMarkdown :markdown="part.text" />
    </div>
    <div v-else-if="part.type === 'reasoning'" :class="ui.reasoning()">
      <ChatMarkdown :markdown="part.text" />
    </div>
    <DynamicToolPart v-else-if="part.type === 'dynamic-tool'" :part="part" />
  </template>
</template>
