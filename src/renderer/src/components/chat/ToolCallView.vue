<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  FilePenLine,
  LoaderCircle,
  Search,
  Terminal,
  Wrench
} from '@lucide/vue'
import type { ToolCallContent, ToolResultMessage } from '@shared/types/workspace'
import Dialog from '@renderer/components/ui/Dialog.vue'
import BranchNavigator from './BranchNavigator.vue'
import { toolActivityKind, toolActivityTarget } from './message-activity'

const props = defineProps<{
  block: ToolCallContent
  running?: boolean
  result?: ToolResultMessage
  resultEntryId?: string
  hideInput?: boolean
}>()
const { t } = useI18n()
const open = ref(false)
const previewSrc = ref<string | null>(null)
const previewOpen = ref(false)
const kind = computed(() => toolActivityKind(props.block.toolName))
const icon = computed(() => {
  if (props.result?.isError) return CircleAlert
  if (props.running) return LoaderCircle
  return {
    read: BookOpen,
    search: Search,
    write: FilePenLine,
    edit: FilePenLine,
    command: Terminal,
    tool: Wrench,
    thinking: Wrench
  }[kind.value]
})
const label = computed(() => {
  if (kind.value === 'tool') return props.block.toolName || t('workspace.unknownTool')
  return t(
    `workspace.activity.${props.running ? 'running' : props.result ? 'done' : 'pending'}.${kind.value}`
  )
})
const target = computed(() => toolActivityTarget(props.block))
const args = computed(() =>
  kind.value === 'command' && typeof props.block.input.command === 'string'
    ? `$ ${props.block.input.command}`
    : props.block.rawInput || JSON.stringify(props.block.input, null, 2)
)
const output = computed(
  () =>
    props.result?.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n') ?? ''
)
const images = computed(
  () =>
    props.result?.content.flatMap((block) =>
      block.type === 'image' && block.data && block.mimeType.startsWith('image/')
        ? [`data:${block.mimeType};base64,${block.data}`]
        : []
    ) ?? []
)

function previewImage(src: string) {
  previewSrc.value = src
  previewOpen.value = true
}

function onToggle(event: Event) {
  open.value = (event.target as HTMLDetailsElement).open
}
</script>

<template>
  <details class="tool-call-hud activity-details" :open="open" @toggle="onToggle">
    <summary class="activity-line" :class="{ 'activity-error': result?.isError }">
      <component
        :is="icon"
        aria-hidden="true"
        class="size-3.5 shrink-0"
        :class="{ 'animate-spin': running }"
      />
      <span class="shrink-0">{{ label }}</span>
      <span v-if="target" class="activity-target min-w-0 truncate text-[var(--text-tertiary)]">{{
        target
      }}</span>
      <span v-if="result?.isError" class="shrink-0">· {{ t('common.failed') }}</span>
      <ChevronRight aria-hidden="true" class="activity-chevron size-3 shrink-0" />
    </summary>
    <div v-if="open" class="activity-output">
      <p class="mb-2 text-[11px] text-[var(--text-tertiary)]">
        {{ kind === 'command' ? 'Shell' : block.toolName }}
      </p>
      <pre v-if="!hideInput" class="activity-code" v-text="args" />
      <pre
        v-if="output"
        class="activity-code"
        :class="{ 'text-[var(--danger)]': result?.isError }"
        v-text="output"
      />
      <div v-if="images.length" class="flex flex-wrap gap-2 p-2">
        <button
          v-for="src in images"
          :key="src"
          type="button"
          :title="t('workspace.previewImage')"
          class="overflow-hidden rounded border border-[var(--border-subtle)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          @click="previewImage(src)"
        >
          <img :src="src" alt="" loading="lazy" class="max-h-40 max-w-60 object-contain" />
        </button>
      </div>
      <BranchNavigator v-if="resultEntryId" :entry-id="resultEntryId" />
    </div>
    <Dialog v-model:open="previewOpen" wide :title="t('workspace.previewImage')">
      <img v-if="previewSrc" :src="previewSrc" alt="" class="max-h-[68vh] w-full object-contain" />
    </Dialog>
  </details>
</template>

<style scoped>
.activity-details {
  min-width: 0;
}
.activity-line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 7px 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  list-style: none;
}
.activity-line::-webkit-details-marker {
  display: none;
}
.activity-line:hover {
  color: var(--text-primary);
}
.activity-line:focus-visible {
  outline: none;
  border-radius: var(--radius-xs);
  box-shadow: var(--focus-ring);
}
.activity-target {
  font-family: var(--font-mono);
  font-style: normal;
}
.activity-error {
  color: var(--danger);
}
.activity-chevron {
  color: var(--text-tertiary);
  transition: transform 150ms;
}
.activity-details[open] > .activity-line .activity-chevron {
  transform: rotate(90deg);
}
.activity-output {
  margin: 6px 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface-raised);
}
.activity-code {
  max-height: 20rem;
  overflow: auto;
  padding: 6px 0;
  margin-bottom: 6px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (prefers-reduced-motion: reduce) {
  .activity-chevron {
    transition: none;
  }
}
</style>
