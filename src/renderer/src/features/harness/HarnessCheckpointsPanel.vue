<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitBranch, GitCommitHorizontal, MapPin, Plus, Split, Undo2 } from '@lucide/vue'
import type { HarnessCheckpoint } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'

const { locale } = useI18n()
const harness = useHarnessStore()
const resumePrompt = ref<Record<string, string>>({})
const busyId = ref<string | null>(null)

const checkpoints = computed<HarnessCheckpoint[]>(() => [...harness.checkpoints])

const reasonLabel: Record<HarnessCheckpoint['reason'], string> = {
  manual: 'workspace.harnessCheckpointReasonManual',
  'pre-run': 'workspace.harnessCheckpointReasonPreRun',
  'post-run': 'workspace.harnessCheckpointReasonPostRun',
  'pre-recovery': 'workspace.harnessCheckpointReasonPreRecovery'
}

const kindLabel: Record<HarnessCheckpoint['kind'], string> = {
  logical: 'workspace.harnessCheckpointKindLogical',
  git: 'workspace.harnessCheckpointKindGit',
  session: 'workspace.harnessCheckpointKindSession'
}

function time(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

function dirtySummary(checkpoint: HarnessCheckpoint): string {
  if (!checkpoint.gitDirtyState) return ''
  const parts: string[] = []
  if (checkpoint.gitDirtyState.modified)
    parts.push(`M ${checkpoint.gitDirtyState.modified}`)
  if (checkpoint.gitDirtyState.added) parts.push(`A ${checkpoint.gitDirtyState.added}`)
  if (checkpoint.gitDirtyState.deleted) parts.push(`D ${checkpoint.gitDirtyState.deleted}`)
  return parts.join(' · ')
}

async function create(): Promise<void> {
  busyId.value = 'new'
  try {
    await harness.createCheckpoint(true)
  } finally {
    busyId.value = null
  }
}

async function resume(checkpoint: HarnessCheckpoint): Promise<void> {
  busyId.value = checkpoint.id
  try {
    const message = resumePrompt.value[checkpoint.id]?.trim()
    await harness.resumeCheckpoint(checkpoint.id, message || undefined)
    resumePrompt.value[checkpoint.id] = ''
  } finally {
    busyId.value = null
  }
}

async function fork(checkpoint: HarnessCheckpoint): Promise<void> {
  busyId.value = checkpoint.id
  try {
    await harness.forkCheckpoint(checkpoint.id)
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <section class="harness-card max-w-4xl" data-testid="harness-checkpoints-panel">
    <div class="flex items-center justify-between gap-2">
      <h3 class="harness-card-title">{{ $t('workspace.harnessCheckpoints') }}</h3>
      <button
        type="button"
        class="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-1 text-[11px] text-[var(--accent)] transition-colors hover:brightness-95 disabled:opacity-50"
        :disabled="busyId !== null"
        data-testid="harness-checkpoint-create"
        @click="create"
      >
        <Plus class="size-3" />
        {{ $t('workspace.harnessCheckpointCreate') }}
      </button>
    </div>
    <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessCheckpointHint') }}
    </p>

    <p v-if="!checkpoints.length" class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessCheckpointsEmpty') }}
    </p>

    <ol v-else class="mt-3 space-y-2">
      <li
        v-for="checkpoint in checkpoints"
        :key="checkpoint.id"
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        data-testid="harness-checkpoint-item"
      >
        <div class="flex flex-wrap items-center gap-2 text-[11px]">
          <span class="font-medium text-[var(--text-primary)]">
            {{ $t(reasonLabel[checkpoint.reason]) }}
          </span>
          <span class="rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
            {{ $t(kindLabel[checkpoint.kind]) }}
          </span>
          <span class="text-[var(--text-tertiary)]">{{ time(checkpoint.createdAt) }}</span>
          <span
            v-if="checkpoint.gitBranch"
            class="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-tertiary)]"
          >
            <GitBranch class="size-3" />{{ checkpoint.gitBranch }}
          </span>
          <span
            v-if="checkpoint.gitCommit"
            class="inline-flex items-center gap-1 font-mono text-[10.5px] text-[var(--text-tertiary)]"
          >
            <GitCommitHorizontal class="size-3" />{{ checkpoint.gitCommit.slice(0, 7) }}
          </span>
          <span v-if="dirtySummary(checkpoint)" class="text-[10.5px] text-[var(--warning)]">
            {{ dirtySummary(checkpoint) }}
          </span>
          <span
            v-if="checkpoint.contextState?.percent !== null && checkpoint.contextState?.percent !== undefined"
            class="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-tertiary)]"
          >
            <MapPin class="size-3" />{{ checkpoint.contextState.percent.toFixed(0) }}%
          </span>
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-2">
          <input
            v-model="resumePrompt[checkpoint.id]"
            type="text"
            :placeholder="$t('workspace.harnessCheckpointResumePrompt')"
            class="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
            :data-testid="`harness-checkpoint-resume-input`"
          />
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="busyId !== null"
            :title="$t('workspace.harnessCheckpointResumeHint')"
            @click="resume(checkpoint)"
          >
            <Undo2 class="size-3" />
            {{ $t('workspace.harnessCheckpointResume') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="busyId !== null"
            :title="$t('workspace.harnessCheckpointForkHint')"
            @click="fork(checkpoint)"
          >
            <Split class="size-3" />
            {{ $t('workspace.harnessCheckpointFork') }}
          </button>
        </div>
      </li>
    </ol>
  </section>
</template>
