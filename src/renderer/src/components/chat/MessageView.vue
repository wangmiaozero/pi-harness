<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentMessage, ImageContent } from '@shared/types/workspace'
import ToolCallView from './ToolCallView.vue'
import BranchNavigator from './BranchNavigator.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'

const props = defineProps<{
  message: AgentMessage
  entryId?: string
  streaming?: boolean
}>()
const previewSrc = ref<string | null>(null)
const previewOpen = ref(false)

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
      class="mb-1 text-[10.5px] font-medium uppercase tracking-[0.05em] text-[var(--text-tertiary)]"
    >
      <template v-if="message.role === 'user'">{{ $t('workspace.roleUser') }}</template>
      <template v-else-if="message.role === 'assistant'">
        {{ $t('workspace.roleAssistant') }}
        <span v-if="streaming"> · {{ $t('workspace.streaming') }}</span>
      </template>
      <template v-else-if="message.role === 'toolResult'">{{ $t('workspace.roleTool') }}</template>
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
          v-if="block.type === 'text'"
          class="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]"
        >
          {{ block.text }}
        </p>
        <details
          v-else-if="block.type === 'thinking'"
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
    </div>

    <pre
      v-else-if="message.role === 'toolResult'"
      class="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--bg-surface)] px-3 py-2 font-[family-name:var(--font-mono)] text-[11.5px]"
      :class="message.isError ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'"
    >{{ toolResultText }}</pre>

    <pre
      v-else-if="message.role === 'bashExecution'"
      class="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--bg-surface)] px-3 py-2 font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-secondary)]"
    >{{ bashText }}</pre>

    <p v-else class="whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]">
      {{ typeof message.content === 'string' ? message.content : '' }}
    </p>

    <BranchNavigator v-if="entryId" :entry-id="entryId" />

    <Dialog v-model:open="previewOpen" wide :title="$t('workspace.previewImage')">
      <img v-if="previewSrc" :src="previewSrc" alt="" class="max-h-[68vh] w-full object-contain" />
    </Dialog>
  </article>
</template>
