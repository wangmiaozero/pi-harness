<script setup lang="ts">
import { Markdown } from '@comark/vue'
import security from '@comark/vue/plugins/security'
import taskList from '@comark/vue/plugins/task-list'
import { computed, onErrorCaptured, ref } from 'vue'
import type { AgentMessage, ImageContent } from '@shared/types/workspace'
import ToolCallView from './ToolCallView.vue'
import BranchNavigator from './BranchNavigator.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'

const markdownOptions = {
  registerDefaultPlugins: false
}
const markdownPlugins = [
  taskList(),
  security({
    allowedTags: [
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      's',
      'code',
      'pre',
      'blockquote',
      'hr',
      'br',
      'a',
      'img',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'input'
    ],
    allowedProtocols: ['http', 'https', 'mailto'],
    allowDataImages: false
  })
]

const props = defineProps<{
  message: AgentMessage
  entryId?: string
  streaming?: boolean
}>()
const previewSrc = ref<string | null>(null)
const previewOpen = ref(false)
const markdownFailed = ref(false)

onErrorCaptured(() => {
  markdownFailed.value = true
  return false
})

function imageSource(image: ImageContent): string | null {
  const source = (image as { source?: ImageContent['source'] }).source
  if (source?.type === 'base64' && source.data) {
    const mime = source.media_type?.startsWith('image/') ? source.media_type : 'image/png'
    return `data:${mime};base64,${source.data}`
  }
  if (source?.type === 'url' && source.url?.startsWith('data:image/')) {
    return source.url
  }
  const legacy = image as ImageContent & { data?: string; mimeType?: string }
  if (legacy.data) {
    const mime = legacy.mimeType?.startsWith('image/') ? legacy.mimeType : 'image/png'
    return `data:${mime};base64,${legacy.data}`
  }
  return null
}

function openPreview(src: string) {
  previewSrc.value = src
  previewOpen.value = true
}

function openImage(image: ImageContent) {
  const src = imageSource(image)
  if (src) openPreview(src)
}

const userText = computed(() => {
  const msg = props.message
  if (msg.role !== 'user') return ''
  return typeof msg.content === 'string'
    ? msg.content
    : msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('\n')
})

const userImages = computed(() => {
  const msg = props.message
  if (msg.role !== 'user' || typeof msg.content === 'string') return []
  return msg.content.flatMap((block) => {
    if (block.type !== 'image') return []
    const src = imageSource(block)
    return src ? [src] : []
  })
})

const toolResultText = computed(() => {
  const msg = props.message
  if (msg.role !== 'toolResult') return ''
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
})

const bashText = computed(() => {
  const msg = props.message
  if (msg.role !== 'bashExecution') return ''
  return `$ ${msg.command}\n${msg.output}`
})
</script>

<template>
  <article class="mb-3">
    <p
      v-if="message.role !== 'toolResult'"
      class="mb-1 text-[10.5px] font-medium uppercase tracking-[0.05em] text-[var(--text-tertiary)]"
    >
      <template v-if="message.role === 'user'">{{ $t('workspace.roleUser') }}</template>
      <template v-else-if="message.role === 'assistant'">
        {{ $t('workspace.roleAssistant') }}
        <span v-if="streaming"> · {{ $t('workspace.streaming') }}</span>
      </template>
      <template v-else-if="message.role === 'bashExecution'">bash</template>
      <template v-else>{{ message.customType }}</template>
    </p>

    <div
      v-if="message.role === 'user'"
      class="rounded-[var(--radius-sm)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] text-[var(--text-primary)]"
    >
      <p v-if="userText" class="whitespace-pre-wrap">{{ userText }}</p>
      <div v-if="userImages.length" class="flex flex-wrap gap-2" :class="userText ? 'mt-2' : ''">
        <button
          v-for="(src, index) in userImages"
          :key="index"
          type="button"
          class="block size-[72px] overflow-hidden rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          :title="$t('workspace.previewImage')"
          @click="openPreview(src)"
        >
          <img :src="src" alt="" loading="lazy" class="size-full object-cover" />
        </button>
      </div>
    </div>

    <div v-else-if="message.role === 'assistant'" class="space-y-2">
      <template v-for="(block, i) in message.content" :key="i">
        <p
          v-if="block.type === 'text' && markdownFailed"
          class="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]"
        >
          {{ block.text }}
        </p>
        <Suspense v-else-if="block.type === 'text'">
          <Markdown
            :value="block.text"
            :options="markdownOptions"
            :plugins="markdownPlugins"
            :streaming="streaming"
            class="markdown-content"
          />
          <template #fallback>
            <p class="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]">
              {{ block.text }}
            </p>
          </template>
        </Suspense>
        <details
          v-else-if="block.type === 'thinking'"
          open
          data-testid="thinking-details"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1"
        >
          <summary class="cursor-pointer text-[11px] text-[var(--text-tertiary)]">
            {{ $t('workspace.thinking') }}
          </summary>
          <p class="mt-1 whitespace-pre-wrap text-[12px] text-[var(--text-secondary)]">
            {{ block.thinking || (block.deferred ? $t('workspace.thinkingDeferred') : '') }}
          </p>
        </details>
        <ToolCallView v-else-if="block.type === 'toolCall'" :block="block" />
        <button
          v-else-if="block.type === 'image' && imageSource(block)"
          type="button"
          class="block max-w-[320px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          :title="$t('workspace.previewImage')"
          @click="openImage(block)"
        >
          <img
            :src="imageSource(block) ?? ''"
            alt=""
            loading="lazy"
            class="max-h-[280px] w-full object-contain"
          />
        </button>
      </template>
      <p
        v-if="message.errorMessage"
        data-testid="assistant-error"
        class="rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--danger)]"
      >
        {{ message.errorMessage }}
      </p>
    </div>

    <details
      v-else-if="message.role === 'toolResult'"
      open
      data-testid="tool-result-details"
      class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      <summary
        class="cursor-pointer px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.05em] text-[var(--text-tertiary)] select-none"
      >
        {{ $t('workspace.roleTool') }}
      </summary>
      <pre
        class="max-h-[32rem] overflow-auto whitespace-pre-wrap border-t border-[var(--border-subtle)] px-3 py-2 font-[family-name:var(--font-mono)] text-[11.5px]"
        :class="message.isError ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'"
        v-text="toolResultText"
      />
    </details>

    <pre
      v-else-if="message.role === 'bashExecution'"
      class="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--bg-surface)] px-3 py-2 font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-secondary)]"
      v-text="bashText"
    />

    <p v-else class="whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]">
      {{ typeof message.content === 'string' ? message.content : '' }}
    </p>

    <BranchNavigator v-if="entryId" :entry-id="entryId" />

    <Dialog v-model:open="previewOpen" wide :title="$t('workspace.previewImage')">
      <img v-if="previewSrc" :src="previewSrc" alt="" class="max-h-[68vh] w-full object-contain" />
    </Dialog>
  </article>
</template>

<style scoped>
.markdown-content {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.65;
}

.markdown-content :deep(p),
.markdown-content :deep(ul),
.markdown-content :deep(ol),
.markdown-content :deep(pre),
.markdown-content :deep(blockquote),
.markdown-content :deep(table) {
  margin: 0 0 0.75em;
}

.markdown-content :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin: 1.15em 0 0.55em;
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.3;
}

.markdown-content :deep(h1:first-child),
.markdown-content :deep(h2:first-child),
.markdown-content :deep(h3:first-child),
.markdown-content :deep(h4:first-child),
.markdown-content :deep(h5:first-child),
.markdown-content :deep(h6:first-child) {
  margin-top: 0;
}

.markdown-content :deep(h1) {
  font-size: 1.45em;
}

.markdown-content :deep(h2) {
  font-size: 1.3em;
}

.markdown-content :deep(h3) {
  font-size: 1.15em;
}

.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  font-size: 1em;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
}

.markdown-content :deep(ul) {
  list-style: disc;
}

.markdown-content :deep(ol) {
  list-style: decimal;
}

.markdown-content :deep(li) {
  margin: 0.2em 0;
}

.markdown-content :deep(li > ul),
.markdown-content :deep(li > ol) {
  margin: 0.2em 0;
}

.markdown-content :deep(strong) {
  font-weight: 650;
}

.markdown-content :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-content :deep(code) {
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-surface-raised);
  padding: 0.08em 0.35em;
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.markdown-content :deep(pre) {
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  padding: 10px 12px;
  line-height: 1.55;
}

.markdown-content :deep(pre code) {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  font-size: 12px;
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--border-strong);
  padding-left: 0.85em;
  color: var(--text-secondary);
}

.markdown-content :deep(hr) {
  margin: 1em 0;
  border: 0;
  border-top: 1px solid var(--border-subtle);
}

.markdown-content :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--border-default);
  padding: 5px 8px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--bg-surface);
  font-weight: 600;
}

.markdown-content :deep(img) {
  max-width: 100%;
  border-radius: var(--radius-sm);
}

.markdown-content :deep(.contains-task-list) {
  padding-left: 0;
  list-style: none;
}

.markdown-content :deep(.task-list-item) {
  list-style: none;
}

.markdown-content :deep(.task-list-item-checkbox) {
  width: 13px;
  height: 13px;
  margin: 0 0.45em 0 0;
  vertical-align: -2px;
  accent-color: var(--accent);
  appearance: auto;
}
</style>
