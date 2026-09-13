<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, Copy, FileCode2, History } from '@lucide/vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import type { GitCommitDetails, GitCommitFileInfo } from '@shared/types/workspace'

/**
 * Overlay drawer with one commit's details, drawn OVER the commit panel —
 * not swapped with it — so the panel's scroll position and the split width
 * survive open and close. Same trick the reference app uses for its right
 * pane ZStack.
 */
const props = defineProps<{
  details: GitCommitDetails
  loading?: boolean
  selectedFile: GitCommitFileInfo | null
}>()

defineEmits<{
  close: []
  'open-file': [file: GitCommitFileInfo]
  'file-history': [filePath: string]
}>()

const parentCount = computed(() => props.details.parents?.length ?? 0)

function fileStatusClass(status: GitCommitFileInfo['status']): string {
  if (status === 'A') return 'text-[var(--success)]'
  if (status === 'D') return 'text-[var(--danger)]'
  if (status === 'R' || status === 'C') return 'text-[var(--warning)]'
  return 'text-[var(--accent)]'
}

async function copyHash() {
  await navigator.clipboard.writeText(props.details.hash)
}
</script>

<template>
  <section
    class="absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col bg-[var(--bg-surface-raised)]"
    data-testid="git-commit-review"
  >
    <header
      class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2"
    >
      <IconButton
        :label="$t('workspace.gitBackToPanel')"
        data-testid="git-back-to-panel"
        @click="$emit('close')"
      >
        <ArrowLeft class="size-3.5" />
      </IconButton>
      <span class="text-[10.5px] font-semibold text-[var(--text-secondary)]">
        {{ $t('workspace.gitCommitDetails') }}
      </span>
    </header>

    <div v-if="loading" class="space-y-2 p-3">
      <div class="h-4 animate-pulse rounded bg-[var(--bg-hover)]" />
      <div class="h-12 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
    <template v-else>
      <div class="shrink-0 border-b border-[var(--border-subtle)] p-3">
        <h3 class="text-[12px] font-semibold leading-snug text-[var(--text-primary)]">
          {{ details.subject }}
        </h3>
        <p
          v-if="details.body"
          class="mt-1 whitespace-pre-wrap text-[10.5px] leading-relaxed text-[var(--text-secondary)]"
        >
          {{ details.body }}
        </p>
        <p class="mt-2 text-[9.5px] text-[var(--text-tertiary)]">
          {{ details.author }} &lt;{{ details.email }}&gt;
        </p>
        <div class="mt-1 flex items-center gap-1 text-[9.5px] text-[var(--text-tertiary)]">
          <code>{{ details.hash }}</code>
          <IconButton :label="$t('common.copy')" @click="copyHash">
            <Copy class="size-3" />
          </IconButton>
          <span v-if="parentCount > 1" class="ml-1">
            {{ $t('workspace.gitParents', { count: parentCount }) }}
          </span>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col">
        <div
          class="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2 text-[10px] font-semibold text-[var(--text-secondary)]"
        >
          {{ $t('workspace.gitChangedFiles', { count: details.files.length }) }}
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-1">
          <button
            v-for="file in details.files"
            :key="`${file.status}-${file.path}`"
            type="button"
            class="group flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
            :class="selectedFile?.path === file.path ? 'bg-[var(--bg-selected)]' : ''"
            :title="file.path"
            @click="$emit('open-file', file)"
            @contextmenu.prevent="$emit('file-history', file.path)"
          >
            <span
              class="w-3 shrink-0 font-[family-name:var(--font-mono)] text-[9.5px] font-bold"
              :class="fileStatusClass(file.status)"
            >
              {{ file.status }}
            </span>
            <span class="min-w-0 flex-1 truncate text-[10px] text-[var(--text-secondary)]">
              {{ file.path }}
            </span>
            <IconButton
              :label="$t('workspace.gitFileHistory')"
              class="opacity-0 group-hover:opacity-100"
              @click.stop="$emit('file-history', file.path)"
            >
              <History class="size-3" />
            </IconButton>
          </button>
          <div
            v-if="!details.files.length"
            class="flex min-h-28 items-center justify-center px-4 text-center text-[10px] text-[var(--text-disabled)]"
          >
            {{ $t('workspace.gitNoPatch') }}
          </div>
        </div>
        <p
          class="shrink-0 border-t border-[var(--border-subtle)] px-3 py-1.5 text-[9px] text-[var(--text-disabled)]"
        >
          <FileCode2 class="mr-1 inline size-2.5 align-[-2px]" />
          {{ $t('workspace.gitSelectCommitFile') }}
        </p>
      </div>
    </template>
  </section>
</template>
