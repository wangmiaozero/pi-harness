<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from '@lucide/vue'
import type { HarnessEvaluation, HarnessEvaluationStage } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'

const { t } = useI18n()
const harness = useHarnessStore()

const evaluations = computed<HarnessEvaluation[]>(() => [...harness.evaluations])

// Local expansion state kept outside the store — pure UI concern.
const expandedIds = ref<string[]>([])
const expanded = computed<Set<string>>(() => new Set(expandedIds.value))
const checkTone: Record<string, string> = {
  passed: 'text-[var(--success)]',
  warning: 'text-[var(--warning)]',
  failed: 'text-[var(--error)]'
}

function runLabel(evaluation: HarnessEvaluation): string {
  const run = harness.runs.find((item) => item.id === evaluation.runId)
  return run?.prompt || evaluation.runId
}

function toggle(evaluation: HarnessEvaluation): void {
  const index = expandedIds.value.indexOf(evaluation.runId)
  if (index >= 0) expandedIds.value.splice(index, 1)
  else expandedIds.value.push(evaluation.runId)
}

function time(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp)
}

function presetLabel(evaluation: HarnessEvaluation): string {
  const preset = evaluation.pipeline?.preset
  if (preset === 'fast') return 'Fast'
  if (preset === 'strict') return 'Strict'
  if (preset === 'custom') return 'Custom'
  return 'Standard'
}

function stageLabel(stage: HarnessEvaluationStage): string {
  return (
    stage.name ||
    t(`workspace.harnessStage_${stage.kind.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`)
  )
}
</script>

<template>
  <section class="harness-card max-w-4xl" data-testid="harness-evaluation-panel">
    <h3 class="harness-card-title">{{ $t('workspace.harnessEvaluation') }}</h3>
    <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessEvaluationHint') }}
    </p>

    <p v-if="!evaluations.length" class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessEvaluationsEmpty') }}
    </p>

    <ol v-else class="mt-3 space-y-2">
      <li
        v-for="evaluation in evaluations"
        :key="evaluation.runId"
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        data-testid="harness-evaluation-item"
      >
        <button
          type="button"
          class="flex w-full items-center gap-2 text-left"
          @click="toggle(evaluation)"
        >
          <component
            :is="evaluation.status === 'passed' ? CheckCircle2 : evaluation.status === 'warning' ? AlertTriangle : XCircle"
            class="size-3.5 shrink-0"
            :class="checkTone[evaluation.status]"
          />
          <span class="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-primary)]">
            {{ runLabel(evaluation) }}
          </span>
          <span class="shrink-0 text-[10.5px] text-[var(--text-tertiary)]">
            {{ time(evaluation.evaluatedAt) }}
          </span>
          <span
            class="shrink-0 text-[10.5px]"
            :class="checkTone[evaluation.status]"
          >
            {{ $t(`workspace.harnessEvaluationStatus.${evaluation.status}`) }}
          </span>
        </button>

        <div v-if="expanded.has(evaluation.runId)" class="mt-2 border-t border-[var(--border-subtle)] pt-2">
          <div v-if="evaluation.pipeline" class="mb-2">
            <p class="text-[10.5px] text-[var(--text-tertiary)]">
              {{ $t('workspace.harnessPolicyEvalPreset') }}: {{ $t(`workspace.harnessPolicyEvalPreset${presetLabel(evaluation)}`) }}
            </p>
            <ul class="mt-1 flex flex-wrap gap-1.5" data-testid="harness-evaluation-stages">
              <li
                v-for="stage in evaluation.pipeline.stages"
                :key="stage.id"
                class="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[10.5px]"
                :title="stage.command ?? undefined"
              >
                <component
                  :is="stage.status === 'passed' ? CheckCircle2 : stage.status === 'warning' ? AlertTriangle : stage.status === 'failed' ? XCircle : MinusCircle"
                  class="size-3 shrink-0"
                  :class="checkTone[stage.status] ?? 'text-[var(--text-tertiary)]'"
                />
                <span class="text-[var(--text-secondary)]">{{ stageLabel(stage) }}</span>
                <span v-if="stage.duration !== null" class="text-[var(--text-tertiary)]">· {{ stage.duration }}ms</span>
              </li>
            </ul>
          </div>
          <ul class="space-y-1">
          <li
            v-for="check in evaluation.checks"
            :key="check.id"
            class="flex items-start gap-2 text-[11px]"
            data-testid="harness-evaluation-check"
          >
            <component
              :is="check.status === 'passed' ? CheckCircle2 : check.status === 'warning' ? AlertTriangle : XCircle"
              class="mt-0.5 size-3 shrink-0"
              :class="checkTone[check.status]"
            />
            <div class="min-w-0">
              <p class="text-[var(--text-secondary)]">
                {{ check.name }}
                <span class="text-[var(--text-tertiary)]">— {{ check.message }}</span>
              </p>
              <pre
                v-if="check.evidence"
                class="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-sm)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[10px] text-[var(--text-tertiary)]"
              >{{ check.evidence }}</pre>
            </div>
          </li>
          </ul>
        </div>
      </li>
    </ol>
  </section>
</template>
