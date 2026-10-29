<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parseStaticMarkdown } from './static-markdown'
import { render } from '@comark/vue/render'
import StreamingMarkdown from './StreamingMarkdown.vue'
import { markdownOptions, markdownPlugins } from './message-markdown'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    value: string
    streaming?: boolean
    options?: Record<string, unknown>
    plugins?: unknown[]
  }>(),
  { options: () => markdownOptions, plugins: () => markdownPlugins }
)
const host = ref<HTMLElement | null>(null)
const visible = ref(typeof IntersectionObserver === 'undefined')
let observer: IntersectionObserver | null = null
const semanticHtml = ref('')
let generation = 0
// Keep offscreen headings, links and tables in the accessibility tree without
// mounting a reactive component tree for every historical Markdown node.
watch(
  () => [props.value, props.options, props.plugins, props.streaming] as const,
  async () => {
    const current = ++generation
    semanticHtml.value = ''
    if (props.streaming || visible.value) return
    try {
      const document = await parseStaticMarkdown(props.value, props.options, props.plugins)
      const pending: unknown[] = [...document.nodes]
      while (pending.length) {
        const node = pending.pop()
        if (!Array.isArray(node)) continue
        if (node[0] === 'img') node[1].loading = 'lazy'
        pending.push(...node.slice(2))
      }
      // The same security plugin supplied to StreamingMarkdown sanitizes this
      // AST. Comark's HTML renderer escapes text and attribute values.
      const html = await render(document, { format: 'text/html' })
      if (current === generation) semanticHtml.value = html
    } catch {
      // Preserve the complete escaped source if formatting cannot be parsed.
      if (current === generation) semanticHtml.value = ''
    }
  },
  { immediate: true }
)
onMounted(() => {
  if (visible.value || !host.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      visible.value = true
      generation++
      semanticHtml.value = ''
      observer?.disconnect()
      observer = null
    },
    { rootMargin: '600px' }
  )
  observer.observe(host.value)
})
onBeforeUnmount(() => {
  generation++
  observer?.disconnect()
})
</script>

<template>
  <div ref="host" v-bind="$attrs">
    <StreamingMarkdown
      v-if="visible || streaming"
      :value="value"
      :streaming="streaming"
      :options="options"
      :plugins="plugins"
    />
    <div v-else-if="semanticHtml" v-html="semanticHtml" />
    <p v-else class="whitespace-pre-wrap text-[13px] leading-relaxed">{{ value }}</p>
  </div>
</template>
