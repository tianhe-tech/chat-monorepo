<script setup lang="ts">
  import type { ResolveElicitationRequestReturn } from '@repo/shared/ai'
  import { UIPartTag } from '@repo/shared/types'
  import { injectChatContext } from '../../Provider.vue'
  import type { DynamicToolUIPart } from 'ai'

  const { chat } = injectChatContext()

  const { part, resolved } = defineProps<{ part: DynamicToolUIPart; resolved: ResolveElicitationRequestReturn }>()

  const { message, accept, cancel, decline } = resolved
  const { input, toolName } = part

  async function onAccept() {
    const result = accept({})
    if (result.isErr()) {
      console.error(result.error)
      part.output = { [UIPartTag.IsElicitationResponse]: true, action: 'cancel' }
    } else {
      part.output = { [UIPartTag.IsElicitationResponse]: true, ...result.value }
    }
    await chat.value.sendMessage()
  }
  async function onDecline() {
    part.output = { [UIPartTag.IsElicitationResponse]: true, ...decline() }
    await chat.value.sendMessage()
  }
  async function onCancel() {
    part.output = { [UIPartTag.IsElicitationResponse]: true, ...cancel() }
    await chat.value.sendMessage()
  }
</script>

<template>
  <div class="flex flex-col gap-4 bg-amber-100 p-4">
    <div>{{ toolName }}</div>
    <div>Elicitation: {{ message }}</div>
    <div class="flex gap-2">
      <UButton @click="onAccept" variant="outline"> 接受 </UButton>
      <UButton @click="onDecline" variant="outline"> 拒绝 </UButton>
      <UButton @click="onCancel" variant="outline"> 取消 </UButton>
    </div>
  </div>
</template>
