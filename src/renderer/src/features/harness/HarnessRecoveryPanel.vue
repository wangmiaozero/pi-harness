<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitBranch, LifeBuoy, RotateCcw, ShieldCheck } from '@lucide/vue'
import type { HarnessRunRelation } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'

const { t } = useI18n()
const harness = useHarnessStore()

const recoveryRuns = computed(() =>
  harness.runs.filter(
    (run) => run.relation === 'recovery' || run.relation === 'retry' || run.relation === 'fork'
  )
)

const retryable = computed(
  () =>
    harness.runs.some(
      (run) => (run.status === 'failed' || run.status === 'aborted') && run.prompt.trim()
    ) ?? false
)

const relationTone: Record<HarnessRunRelation, string> = {
  original: 'text-[var(--text-tertiary)]',
  fork: 'text-[var(--accent)]',
  retry: 'text-[var(--warning)]',
  recovery: 'text-[var(--success)]',
  rerun: 'text-[var(--accent)]'
}

async function retry(): Promise<void> {
  await harness.retryLastRun()
}

async function openDetail(runId: string): Promise<void> {
  await harness.loadRunDetail(runId)
}
</script>

<template>
  <section class="harness-card" data-testid="harness-recovery-panel">
    <h3 class="harness-card-title">{{ t('workspace.harnessRecovery') }}</h3>

    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
        :disabled="!retryable || harness.mutating"
        :title="t('workspace.harnessRetryLastRunHint')"
        data-testid="harness-recovery-retry"
        @click="retry"
      >
        <RotateCcw class="size-3" />
        {{ t('workspace.harnessRetryLastRun') }}
      </button>
      <p class="self-center text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('workspace.harnessRecoveryCheckpointsHint') }}
      </p>
    </div>

    <p
      class="mt-4 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
    >
      <LifeBuoy class="size-3" />
      {{ t('workspace.harnessRecoveryRuns') }}
    </p>
    <p v-if="!recoveryRuns.length" class="mt-2 text-[12px] text-[var(--text-tertiary)]">
      {{ t('workspace.harnessRecoveryRunsEmpty') }}
    </p>
    <ol v-else class="mt-2 space-y-1">
      <li v-for="run in recoveryRuns" :key="run.id">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
          data-testid="harness-recovery-run"
          @click="openDetail(run.id)"
        >
          <component
            :is="
              run.relation === 'fork'
                ? GitBranch
                : run.relation === 'recovery'
                  ? ShieldCheck
                  : RotateCcw
            "
            class="size-3.5 shrink-0"
            :class="relationTone[run.relation]"
          />
          <span class="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-primary)]">
            {{ run.prompt || t('workspace.harnessRunUntitled') }}
          </span>
          <span class="shrink-0 text-[10px]" :class="relationTone[run.relation]">
            {{ t(`workspace.harnessRunRelation.${run.relation}`) }}
          </span>
          <span class="shrink-0 text-[10px] text-[var(--text-tertiary)]">
            {{ t(`workspace.harnessRunStatus.${run.status}`) }}
          </span>
        </button>
      </li>
    </ol>
  </section>
</template>
