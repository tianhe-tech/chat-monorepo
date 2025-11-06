import { ref, watchEffect, toValue, type MaybeRefOrGetter } from 'vue'
import { useScroll, useMutationObserver } from '@vueuse/core'

type UseAutoScrollOptions = {
  behavior?: ScrollBehavior
  throttle?: number
}

/**
 * 纵向自动滚动，用于 ThreadBody
 */
export function useAutoScroll(
  element: MaybeRefOrGetter<HTMLElement | null | undefined>,
  options?: UseAutoScrollOptions,
) {
  const { behavior = 'auto', throttle } = options ?? {}
  const { directions, arrivedState, y } = useScroll(element, { behavior, throttle })
  const isAutoScrolling = ref(false)

  useMutationObserver(
    element,
    () => {
      if (isAutoScrolling.value) {
        y.value += toValue(element)?.scrollHeight ?? 0
      }
    },
    {
      subtree: true,
      childList: true,
      characterData: true,
    },
  )

  watchEffect(() => {
    if (directions.top) {
      isAutoScrolling.value = false
    }
  })

  watchEffect(() => {
    if (arrivedState.bottom) {
      isAutoScrolling.value = true
    }
  })
}
