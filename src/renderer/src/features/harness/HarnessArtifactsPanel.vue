<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  FileCode2,
  FileDiff,
  FileImage,
  FileText,
  GitCommitHorizontal,
  Package,
  Save,
  ScrollText,
  SquareTerminal,
  TestTube2
} from '@lucide/vue'
import type { HarnessArtifactType } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'

const { t, locale } = useI18n()
const harness = useHarnessStore()

const typeFilter = ref<'all' | HarnessArtifactType>('all')

const artifacts = computed(() =>
  harness.artifacts.filter((artifact) =>
    typeFilter.value === 'all' ? true : artifact.type === typeFilter.value
  )
)

const typeIcon: Record<HarnessArtifactType, typeof FileCode2> = {
  file: FileCode2,
  diff: FileDiff,
  patch: FileDiff,
  log: ScrollText,
  'test-report': TestTube2,
  'build-output': Package,
  image: FileImage,
  document: FileText,
  'git-commit': GitCommitHorizontal,
  checkpoint: Save,
  other: SquareTerminal
}

const FILTER_TYPES: HarnessArtifactType[] = [
  'file',
  'log',
  'test-report',
  'build-output',
  'git-commit',
  'checkpoint'
]

function time(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

function runPrompt(runId: string): string {
  const fromList = harness.runs.find((run) => run.id === runId)?.prompt.slice(0, 40)
  if (fromList) return fromList
  if (harness.runDetail?.run.id === runId) return harness.runDetail.run.prompt.slice(0, 40)
  return runId.slice(0, 18)
}
</script>

<template>
  <section class="harness-card" data-testid="harness-artifacts-panel">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="harness-card-title">{{ t('workspace.harnessArtifacts') }}</h3>
      <select
        v-model="typeFilter"
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
        :aria-label="t('workspace.harnessArtifactFilter')"
      >
        <option value="all">{{ t('workspace.harnessArtifactFilterAll') }}</option>
        <option v-for="type in FILTER_TYPES" :key="type" :value="type">
          {{ t(`workspace.harnessArtifactType.${type}`) }}
        </option>
      </select>
    </div>

    <p v-if="!artifacts.length" class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ t('workspace.harnessArtifactsEmpty') }}
    </p>
    <ol v-else class="mt-3 space-y-1">
      <li
        v-for="artifact in artifacts"
        :key="artifact.id"
        class="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-1.5"
        :data-testid="`harness-artifact-${artifact.type}`"
      >
        <component :is="typeIcon[artifact.type]" class="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-[11.5px] text-[var(--text-primary)]">{{ artifact.name }}</p>
          <p class="truncate text-[10px] text-[var(--text-tertiary)]">
            {{ runPrompt(artifact.runId) }} · {{ time(artifact.createdAt) }}
          </p>
        </div>
        <span class="shrink-0 text-[10px] text-[var(--text-tertiary)]">
          {{ t(`workspace.harnessArtifactType.${artifact.type}`) }}
        </span>
      </li>
    </ol>
  </section>
</template>
