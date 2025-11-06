<script lang="ts">
  import { VueMarkdown, type SanitizeOptions, type TVueMarkdown } from '@crazydos/vue-markdown'
  const sanitizeOptions: SanitizeOptions = {
    sanitizeOptions: {
      tagNames: [
        // Default allowed tags
        'a',
        'b',
        'blockquote',
        'br',
        'code',
        'dd',
        'del',
        'details',
        'div',
        'dl',
        'dt',
        'em',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'hr',
        'i',
        'img',
        'li',
        'ol',
        'p',
        'pre',
        'span',
        'strong',
        'table',
        'tbody',
        'td',
        'th',
        'thead',
        'tr',
        'ul',
        // KaTeX specific tags
        'math',
        'mrow',
        'msup',
        'msub',
        'mi',
        'mn',
        'mo',
        'mfrac',
        'msqrt',
        'mroot',
        'mtable',
        'mtr',
        'mtd',
        'mtext',
        'mspace',
        'menclose',
        'annotation',
      ],
      attributes: {
        '*': ['className', 'class', 'id', 'style'],
        span: ['className', 'class', 'style', 'title'],
        math: ['xmlns', 'display'],
        annotation: ['encoding'],
      },
    },
  }
</script>

<script setup lang="ts">
  import rehypeKatex from 'rehype-katex'
  import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
  import remarkGfm from 'remark-gfm'
  import remarkMath from 'remark-math'
  import type { ClassValue } from 'tailwind-variants'
  import _ui from './ui'

  type TVComponentSlots<T extends { slots?: Record<string, any> }> = {
    [K in keyof T['slots']]?: ClassValue
  }
  type MarkdownUI = TVComponentSlots<typeof _ui>

  type VueMarkdownSlots = InstanceType<TVueMarkdown>['$slots']

  const props = defineProps<{ markdown: string; ui?: MarkdownUI }>()
  defineSlots<VueMarkdownSlots>()

  const ui = _ui()
</script>

<template>
  <VueMarkdown
    :markdown="markdown"
    :sanitize="true"
    :sanitizeOptions="sanitizeOptions"
    :remarkPlugins="[remarkGfm, remarkMath]"
    :rehypePlugins="[rehypeKatex]"
  >
    <template #h1="{ children, ...slotProps }">
      <slot name="h1" v-bind="slotProps as any" :children="children as any" :class="ui.h1({ class: props.ui?.h1 })">
        <h1 v-bind="slotProps" :class="ui.h1({ class: props.ui?.h1 })">
          <component :is="children" />
        </h1>
      </slot>
    </template>
    <template #h2="{ children, ...slotProps }">
      <slot name="h2" v-bind="slotProps as any" :children="children as any" :class="ui.h2({ class: props.ui?.h2 })">
        <h2 v-bind="slotProps" :class="ui.h2({ class: props.ui?.h2 })">
          <component :is="children" />
        </h2>
      </slot>
    </template>
    <template #h3="{ children, ...slotProps }">
      <slot name="h3" v-bind="slotProps as any" :children="children as any" :class="ui.h3({ class: props.ui?.h3 })">
        <h3 v-bind="slotProps" :class="ui.h3({ class: props.ui?.h3 })">
          <component :is="children" />
        </h3>
      </slot>
    </template>
    <template #h4="{ children, ...slotProps }">
      <slot name="h4" v-bind="slotProps as any" :children="children as any" :class="ui.h4({ class: props.ui?.h4 })">
        <h4 v-bind="slotProps" :class="ui.h4({ class: props.ui?.h4 })">
          <component :is="children" />
        </h4>
      </slot>
    </template>
    <template #p="{ children, ...slotProps }">
      <slot name="p" v-bind="slotProps as any" :children="children as any" :class="ui.p({ class: props.ui?.p })">
        <p v-bind="slotProps" :class="ui.p({ class: props.ui?.p })">
          <component :is="children" />
        </p>
      </slot>
    </template>
    <template #hr="{ ...slotProps }">
      <slot name="hr" v-bind="slotProps as any" :class="ui.hr({ class: props.ui?.hr })">
        <hr v-bind="slotProps" :class="ui.hr({ class: props.ui?.hr })" />
      </slot>
    </template>
    <template #inline-code="{ children, ...slotProps }">
      <slot
        name="inline-code"
        v-bind="slotProps as any"
        :children="children as any"
        :class="ui.inlineCode({ class: props.ui?.inlineCode })"
      >
        <code v-bind="slotProps" :class="ui.inlineCode({ class: props.ui?.inlineCode })">
          <component :is="children" />
        </code>
      </slot>
    </template>
    <template #li="{ children, ...slotProps }">
      <slot name="li" v-bind="slotProps as any" :children="children as any" :class="ui.li({ class: props.ui?.li })">
        <li v-bind="slotProps" :class="ui.li({ class: props.ui?.li })">
          <component :is="children" />
        </li>
      </slot>
    </template>
    <template #ol="{ children, ...slotProps }">
      <slot name="ol" v-bind="slotProps as any" :children="children as any" :class="ui.ol({ class: props.ui?.ol })">
        <ol v-bind="slotProps" :class="ui.ol({ class: props.ui?.ol })">
          <component :is="children" />
        </ol>
      </slot>
    </template>
    <template #ul="{ children, ...slotProps }">
      <slot name="ul" v-bind="slotProps as any" :children="children as any" :class="ui.ul({ class: props.ui?.ul })">
        <ul v-bind="slotProps" :class="ui.ul({ class: props.ui?.ul })">
          <component :is="children" />
        </ul>
      </slot>
    </template>
    <template #thead="{ children, ...slotProps }">
      <slot
        name="thead"
        v-bind="slotProps as any"
        :children="children as any"
        :class="ui.thead({ class: props.ui?.thead })"
      >
        <thead v-bind="slotProps" :class="ui.thead({ class: props.ui?.thead })">
          <component :is="children" />
        </thead>
      </slot>
    </template>
    <template #tr="{ children, ...slotProps }">
      <slot name="tr" v-bind="slotProps as any" :children="children as any" :class="ui.tr({ class: props.ui?.tr })">
        <tr v-bind="slotProps" :class="ui.tr({ class: props.ui?.tr })">
          <component :is="children" />
        </tr>
      </slot>
    </template>
    <template #th="{ children, ...slotProps }">
      <slot name="th" v-bind="slotProps as any" :children="children as any" :class="ui.th({ class: props.ui?.th })">
        <th v-bind="slotProps" :class="ui.th({ class: props.ui?.th })">
          <component :is="children" />
        </th>
      </slot>
    </template>
    <template #td="{ children, ...slotProps }">
      <slot name="td" v-bind="slotProps as any" :children="children as any" :class="ui.td({ class: props.ui?.td })">
        <td v-bind="slotProps" :class="ui.td({ class: props.ui?.td })">
          <component :is="children" />
        </td>
      </slot>
    </template>
    <template #table="{ children, ...slotProps }">
      <slot
        name="table"
        v-bind="slotProps as any"
        :children="children as any"
        :class="ui.table({ class: props.ui?.table })"
      >
        <ScrollAreaRoot class="my-6 w-full contain-inline-size">
          <ScrollAreaViewport class="max-w-full">
            <table v-bind="slotProps" :class="ui.table({ class: props.ui?.table })">
              <component :is="children" />
            </table>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar class="z-20 flex h-2.5 touch-none select-none flex-col rounded-lg pb-0.5 pt-1">
            <ScrollAreaThumb
              class="bg-(--chat-scrollbar) relative grow rounded-full before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
            />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      </slot>
    </template>
  </VueMarkdown>
</template>
