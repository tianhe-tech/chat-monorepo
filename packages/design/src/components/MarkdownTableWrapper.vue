<script setup lang="ts">
  import { ScrollAreaRoot, ScrollAreaViewport, ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui'
</script>

<template>
  <ScrollAreaRoot class="my-6 w-full contain-inline-size">
    <ScrollAreaViewport class="max-w-full">
      <slot />
    </ScrollAreaViewport>

    <ScrollAreaScrollbar class="z-20 flex h-2.5 touch-none select-none flex-col rounded-lg pb-0.5 pt-1">
      <ScrollAreaThumb
        class="bg-(--color-scrollbar) relative grow rounded-full before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
      />
    </ScrollAreaScrollbar>
  </ScrollAreaRoot>
</template>
