<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRightLeft, Minus, TrendingDown, TrendingUp } from '@lucide/vue'
import type { HarnessRun } from '@shared/types/harness'
import Button from '@renderer/components/ui/Button.vue'
import Select from '@renderer/components/ui/Select.vue'
import { useHarnessStore } from '@renderer/stores/harness'

const { t } = useI18n()
const harness = useHarnessStore()

const runA = ref<string>('')
const runB = ref<string>('')
const comparing = ref(false)
const compareError = ref<string | null>(null)

const runs = computed<HarnessRun[]>(() => harness.runs)
const runOptions = computed(() =>
  runs.value.map((run) => ({ value: run.id, label: runOption(run) }))
)
const comparison = computed(() => harness.comparison)

watch(
  () => harness.runs,
  (next) => {
    if (runA.value && !next.some((run) => run.id === runA.value)) runA.value = ''
    if (runB.value && !next.some((run) => run.id === runB.value)) runB.value = ''
  }
)

async function compare(): Promise<void> {
  if (!runA.value || !runB.value || runA.value === runB.value) return
  comparing.value = true
  compareError.value = null
  try {
    await harness.loadComparison(runA.value, runB.value)
  } catch (cause) {
    compareError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    comparing.value = false
  }
}

function runOption(run: HarnessRun): string {
  const prompt = run.prompt.replace(/\s+/g, ' ').trim().slice(0, 50)
  return `${prompt || t('workspace.harnessRunUntitled')} · ${t(`workspace.harnessRunStatus.${run.status}`)}`
}

const toneClass: Record<string, string> = {
  better: 'text-[var(--success)]',
  worse: 'text-[var(--error)]',
  neutral: 'text-[var(--text-tertiary)]'
}

const diffTone: Record<string, string> = {
  same: 'text-[var(--text-tertiary)]',
  added: 'text-[var(--success)]',
  removed: 'text-[var(--error)]'
}
</script>

<template>
  <section class="harness-card" data-testid="harness-compare-panel">
    <h3 class="harness-card-title">{{ t('workspace.harnessCompare') }}</h3>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <Select
        v-model="runA"
        class="min-w-0 flex-1"
        size="sm"
        :options="runOptions"
        :placeholder="t('workspace.harnessCompareRunA')"
        :aria-label="t('workspace.harnessCompareRunA')"
        data-testid="harness-compare-select-a"
      />
      <ArrowRightLeft class="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
      <Select
        v-model="runB"
        class="min-w-0 flex-1"
        size="sm"
        :options="runOptions"
        :placeholder="t('workspace.harnessCompareRunB')"
        :aria-label="t('workspace.harnessCompareRunB')"
        data-testid="harness-compare-select-b"
      />
      <Button
        class="shrink-0"
        size="sm"
        variant="secondary"
        :disabled="!runA || !runB || runA === runB || comparing"
        :loading="comparing"
        data-testid="harness-compare-submit"
        @click="compare"
      >
        {{ t('workspace.harnessCompareAction') }}
      </Button>
    </div>

    <p v-if="compareError" role="alert" class="mt-2 text-[11.5px] text-[var(--error)]">
      {{ compareError }}
    </p>

    <template v-if="comparison">
      <div class="mt-4 overflow-x-auto" data-testid="harness-compare-metrics">
        <table class="w-full min-w-[30rem] border-collapse text-[11.5px]">
          <thead>
            <tr
              class="border-b border-[var(--border-subtle)] text-left text-[10.5px] uppercase tracking-wide text-[var(--text-tertiary)]"
            >
              <th class="py-1.5 pr-2 font-medium">{{ t('workspace.harnessCompareMetric') }}</th>
              <th class="py-1.5 pr-2 font-medium">A</th>
              <th class="py-1.5 pr-2 font-medium">B</th>
              <th class="py-1.5 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="metric in comparison.metrics"
              :key="metric.id"
              class="border-b border-[var(--border-subtle)] last:border-0"
              :data-testid="`harness-compare-metric-${metric.id}`"
            >
              <td class="py-1.5 pr-2 text-[var(--text-secondary)]">
                {{
                  t(
                    `workspace.harnessCompareMetric_${metric.id.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())}`
                  )
                }}
              </td>
              <td class="py-1.5 pr-2 tabular-nums text-[var(--text-primary)]">{{ metric.a }}</td>
              <td class="py-1.5 pr-2 tabular-nums text-[var(--text-primary)]">{{ metric.b }}</td>
              <td class="py-1.5 tabular-nums" :class="toneClass[metric.tone]">
                <span class="inline-flex items-center gap-1">
                  <component
                    :is="
                      metric.tone === 'better'
                        ? TrendingDown
                        : metric.tone === 'worse'
                          ? TrendingUp
                          : Minus
                    "
                    class="size-3"
                  />
                  {{ metric.delta ?? '—' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="comparison.findings.length" class="mt-4">
        <p
          class="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
        >
          {{ t('workspace.harnessCompareFindings') }}
        </p>
        <ul class="space-y-0.5 text-[11px]">
          <li
            v-for="finding in comparison.findings"
            :key="finding.id"
            class="flex flex-wrap items-center gap-2"
            :class="
              finding.severity === 'regression'
                ? 'text-[var(--error)]'
                : finding.severity === 'improvement'
                  ? 'text-[var(--success)]'
                  : 'text-[var(--text-secondary)]'
            "
          >
            <span class="font-medium">{{
              t(`workspace.harnessRegressionMetric.${finding.metric}`)
            }}</span>
            <span>{{ finding.message }}</span>
            <span v-if="finding.deltaPercent !== null" class="tabular-nums">
              {{ finding.deltaPercent > 0 ? '+' : '' }}{{ finding.deltaPercent }}%
            </span>
          </li>
        </ul>
      </div>

      <div v-for="section in comparison.diffs" :key="section.id" class="mt-4">
        <p
          class="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
        >
          {{ t(`workspace.harnessDiffSection_${section.id}`) }}
        </p>
        <div
          class="max-h-56 overflow-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 font-mono text-[10.5px] leading-relaxed"
        >
          <p
            v-for="(line, index) in section.lines"
            :key="index"
            :class="diffTone[line.kind]"
            :data-testid="`harness-compare-diff-line-${line.kind}`"
          >
            <span class="mr-1.5 select-none opacity-60">
              {{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ' }}
            </span>
            <span>{{ line.text }}</span>
          </p>
        </div>
      </div>
    </template>

    <p v-else class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ t('workspace.harnessCompareEmpty') }}
    </p>
  </section>
</template>
