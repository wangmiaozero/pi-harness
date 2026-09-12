<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Stethoscope, XCircle } from '@lucide/vue'
import type { HarnessRun } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'

const { t } = useI18n()
const harness = useHarnessStore()

const selectedRunId = ref<string>('')
const diagnosing = ref(false)

const problemRuns = computed<HarnessRun[]>(() =>
  harness.runs.filter(
    (run) => run.status === 'failed' || run.status === 'aborted' || run.toolFailureCount > 0
  )
)

const detail = computed(() => harness.runDetail)

async function diagnose(): Promise<void> {
  if (!selectedRunId.value) return
  diagnosing.value = true
  try {
    await harness.loadRunDetail(selectedRunId.value)
  } finally {
    diagnosing.value = false
  }
}
</script>

<template>
  <section class="harness-card" data-testid="harness-diagnostics-panel">
    <h3 class="harness-card-title">{{ t('workspace.harnessDiagnostics') }}</h3>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <select
        v-model="selectedRunId"
        class="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-[11.5px] text-[var(--text-primary)]"
        :aria-label="t('workspace.harnessDiagnosticsRun')"
        data-testid="harness-diagnostics-run-select"
      >
        <option value="" disabled>{{ t('workspace.harnessDiagnosticsRun') }}</option>
        <option v-for="run in problemRuns" :key="run.id" :value="run.id">
          {{ run.prompt.slice(0, 50) || t('workspace.harnessRunUntitled') }} ·
          {{ t(`workspace.harnessRunStatus.${run.status}`) }}
        </option>
      </select>
      <button
        type="button"
        class="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
        :disabled="!selectedRunId || diagnosing"
        @click="diagnose"
      >
        {{ t('workspace.harnessDiagnoseAction') }}
      </button>
    </div>

    <p v-if="!problemRuns.length" class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ t('workspace.harnessDiagnosticsEmpty') }}
    </p>

    <template v-if="detail && detail.diagnostics.length">
      <div class="mt-4 space-y-2">
        <div
          v-for="diagnostic in detail.diagnostics"
          :key="diagnostic.id"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
          :data-testid="`harness-diagnostics-item`"
        >
          <div class="flex flex-wrap items-center gap-2">
            <component
              :is="diagnostic.severity === 'info' || diagnostic.severity === 'warning' ? AlertTriangle : XCircle"
              class="size-4 shrink-0"
              :class="diagnostic.severity === 'info' ? 'text-[var(--text-tertiary)]' : diagnostic.severity === 'warning' ? 'text-[var(--warning)]' : 'text-[var(--error)]'"
            />
            <span class="text-[12.5px] font-medium text-[var(--text-primary)]">
              {{ diagnostic.title }}
            </span>
            <span
              class="rounded-full border px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide"
              :class="diagnostic.severity === 'info' ? 'border-[var(--border-subtle)] text-[var(--text-tertiary)]' : diagnostic.severity === 'warning' ? 'border-[var(--warning)] text-[var(--warning)]' : 'border-[var(--error)] text-[var(--error)]'"
            >
              {{ diagnostic.severity }}
            </span>
            <span class="text-[10px] text-[var(--text-tertiary)]">{{ diagnostic.category }}</span>
          </div>
          <p class="mt-1.5 text-[11.5px] text-[var(--text-secondary)]">{{ diagnostic.message }}</p>
          <pre
            v-if="diagnostic.evidence"
            class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--bg-primary)] p-2 font-mono text-[10px] text-[var(--text-secondary)]"
          >{{ diagnostic.evidence }}</pre>
          <div v-if="diagnostic.causeChain.length" class="mt-2">
            <p class="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              <Stethoscope class="size-3" />
              {{ t('workspace.harnessDiagCauseChain') }}
            </p>
            <ol class="mt-1 space-y-1">
              <li
                v-for="(cause, index) in diagnostic.causeChain"
                :key="index"
                class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
              >
                <span class="font-medium text-[var(--text-primary)]">{{ cause.title }}</span>
                <span class="text-[var(--text-tertiary)]"> — {{ cause.message }}</span>
              </li>
            </ol>
          </div>
          <p v-if="diagnostic.recommendation" class="mt-2 text-[11.5px] text-[var(--text-secondary)]">
            {{ t('workspace.harnessDiagRecommendation') }}: {{ diagnostic.recommendation }}
          </p>
        </div>
      </div>
    </template>
    <p
      v-else-if="selectedRunId && detail && !detail.diagnostics.length"
      class="mt-4 text-[12px] text-[var(--text-tertiary)]"
    >
      {{ t('workspace.harnessDiagnosticsNoIssues') }}
    </p>
  </section>
</template>
