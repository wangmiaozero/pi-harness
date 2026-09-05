<script setup lang="ts">
import { Markdown } from '@comark/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

/**
 * Streaming text arrives as many small deltas, and the Markdown renderer
 * re-parses the whole accumulated document on every value change — O(text²)
 * work that saturates the renderer while a long response streams in.
 *
 * While streaming, re-parse at most once per interval (always with the
 * latest text); flush the final value immediately when streaming stops.
 * Non-streaming values pass straight through, so persisted messages render
 * exactly as before.
 */
const props = withDefaults(
  defineProps<{
    value: string
    streaming?: boolean
    intervalMs?: number
    options?: Record<string, unknown>
    plugins?: unknown[]
  }>(),
  { streaming: false, intervalMs: 64, options: () => ({}), plugins: () => [] }
)

defineOptions({ inheritAttrs: false })

// The concrete comark plugin type lives in a transitive dependency; derive it
// from the wrapped component instead of coupling this wrapper to that type.
type MarkdownProps = InstanceType<typeof Markdown>['$props']
const markdownPlugins = computed(
  () => props.plugins as NonNullable<MarkdownProps>['plugins']
)

const displayed = ref(props.value)
let timer: ReturnType<typeof setTimeout> | null = null

function clearPendingTimer(): void {
  if (timer === null) return
  clearTimeout(timer)
  timer = null
}

watch(
  () => props.value,
  (next) => {
    if (next === displayed.value) return
    if (!props.streaming) {
      clearPendingTimer()
      displayed.value = next
      return
    }
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      displayed.value = props.value
    }, props.intervalMs)
  }
)

watch(
  () => props.streaming,
  (streaming) => {
    if (streaming) return
    clearPendingTimer()
    displayed.value = props.value
  }
)

onBeforeUnmount(clearPendingTimer)
</script>

<template>
  <Markdown
    v-bind="$attrs"
    :value="displayed"
    :options="options"
    :plugins="markdownPlugins"
    :streaming="streaming"
  />
</template>
