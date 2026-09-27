<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, FileDiff, TriangleAlert } from '@lucide/vue'
import type { MessageFileChange, MessageFileChanges } from './message-file-changes'
import { useWorkspaceStore } from '@renderer/stores/workspace'

const props = defineProps<{ changes: MessageFileChanges }>()
const workspace = useWorkspaceStore()
const expanded = ref(false)
const DEFAULT_VISIBLE_FILES = 3

const visibleFiles = computed(() =>
  expanded.value ? props.changes.files : props.changes.files.slice(0, DEFAULT_VISIBLE_FILES)
)
const hiddenCount = computed(() => Math.max(0, props.changes.files.length - DEFAULT_VISIBLE_FILES))

function openDiff(file: MessageFileChange) {
  workspace.openDiffTab(file.path, file.displayPath, {
    key: `${props.changes.runId}:${file.artifactId}`,
    patch: file.patch
  })
}
</script>

<template>
  <section
    data-testid="message-file-changes"
    class="mt-3 overflow-hidden rounded-[10px] border bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]"
    :class="
      changes.status === 'missing-evidence'
        ? 'border-[color-mix(in_srgb,var(--warning)_45%,var(--border-default))]'
        : 'border-[var(--border-default)]'
    "
  >
    <header
      v-if="changes.status === 'missing-evidence'"
      data-testid="message-file-changes-missing"
      class="flex min-h-14 items-center gap-3 px-3 py-2.5"
    >
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_srgb,var(--warning)_12%,var(--bg-surface-raised))] text-[var(--warning)]"
      >
        <TriangleAlert class="size-[18px]" :stroke-width="1.8" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-[12.5px] font-semibold text-[var(--text-primary)]">
          {{ $t('workspace.fileChangesMissing') }}
        </p>
        <p class="mt-0.5 text-[11px] leading-4 text-[var(--text-secondary)]">
          {{ $t('workspace.fileChangesMissingHint') }}
        </p>
      </div>
    </header>

    <header v-else class="flex min-h-14 items-center gap-3 px-3 py-2.5">
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]"
      >
        <FileDiff class="size-[18px]" :stroke-width="1.65" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-[12.5px] font-semibold text-[var(--text-primary)]">
          {{ $t('workspace.fileChangesEdited', { count: changes.files.length }) }}
        </p>
        <p class="mt-0.5 font-[family-name:var(--font-mono)] text-[11px]">
          <span class="text-[var(--success)]">+{{ changes.additions }}</span>
          <span class="ml-1.5 text-[var(--danger)]">-{{ changes.deletions }}</span>
        </p>
      </div>
      <span class="text-[10.5px] text-[var(--text-tertiary)]">
        {{ $t('workspace.fileChangesOpenHint') }}
      </span>
    </header>

    <ul v-if="changes.status === 'verified'" class="border-t border-[var(--border-subtle)] py-1">
      <li v-for="file in visibleFiles" :key="file.artifactId">
        <button
          type="button"
          class="group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent-border)]"
          :title="$t('workspace.fileChangesPreview', { file: file.displayPath })"
          :data-testid="`message-file-change-${file.artifactId}`"
          @click="openDiff(file)"
        >
          <span
            class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
          >
            {{ file.displayPath }}
          </span>
          <span class="shrink-0 font-[family-name:var(--font-mono)] text-[10.5px]">
            <span class="text-[var(--success)]">+{{ file.additions }}</span>
            <span class="ml-1.5 text-[var(--danger)]">-{{ file.deletions }}</span>
          </span>
        </button>
      </li>
    </ul>

    <button
      v-if="changes.status === 'verified' && hiddenCount"
      type="button"
      data-testid="message-file-changes-expand"
      class="flex w-full items-center gap-1 border-t border-[var(--border-subtle)] px-3 py-2 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent-border)]"
      @click="expanded = !expanded"
    >
      {{
        expanded
          ? $t('workspace.fileChangesCollapse')
          : $t('workspace.fileChangesMore', { count: hiddenCount })
      }}
      <ChevronDown class="size-3.5 transition-transform" :class="expanded ? 'rotate-180' : ''" />
    </button>
  </section>
</template>
