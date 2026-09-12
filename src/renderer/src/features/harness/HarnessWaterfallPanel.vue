<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Waves } from '@lucide/vue'
import type { HarnessRun, HarnessTraceSpan } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'

const { t } = useI18n()
const harness = useHarnessStore()

const selectedRunId = ref<string>('')
const loading = ref(false)

const runs = computed<HarnessRun[]>(() => harness.runs)
const detail = computed(() => harness.runDetail)
const spans = computed<HarnessTraceSpan[]>(() => detail.value?.trace?.spans ?? [])

const start = computed(() =>
  spans.value.length ? Math.min(...spans.value.map((span) => span.startedAt)) : 0
)
const end = computed(() =>
  spans.value.length
    ? Math.max(...spans.value.map((span) => span.finishedAt ?? span.startedAt))
    : 0
)
const totalWindow = computed(() => Math.max(1, end.value - start.value))

const statusTone: Record<string, string> = {
  success: 'bg-[var(--success)]',
  failed: 'bg-[var(--error)]',
  running: 'bg-[var(--accent)]',
  skipped: 'bg-[var(--text-disabled)]'
}

async function loadTrace(): Promise<void> {
  if (!selectedRunId.value) return
  loading.value = true
  try {
    await harness.loadRunDetail(selectedRunId.value)
  } finally {
    loading.value = false
  }
}

function offset(span: HarnessTraceSpan): number {
  return ((span.startedAt - start.value) / totalWindow.value) * 100
}

function width(span: HarnessTraceSpan): number {
  const duration = (span.finishedAt ?? span.startedAt) - span.startedAt
  return Math.max(0.75, (duration / totalWindow.value) * 100)
}

function durationLabel(span: HarnessTraceSpan): string {
  if (span.duration === null) return '—'
  if (span.duration < 1000) return `${span.duration}ms`
  return `${(span.duration / 1000).toFixed(1)}s`
}
</script>

<template>
  <section class="harness-card" data-testid="harness-waterfall-panel">
    <h3 class="harness-card-title">{{ t('workspace.harnessWaterfall') }}</h3>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <select
        v-model="selectedRunId"
        class="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-[11.5px] text-[var(--text-primary)]"
        :aria-label="t('workspace.harnessWaterfallRun')"
        data-testid="harness-waterfall-run-select"
      >
        <option value="" disabled>{{ t('workspace.harnessWaterfallRun') }}</option>
        <option v-for="run in runs" :key="run.id" :value="run.id">
          {{ run.prompt.slice(0, 50) || t('workspace.harnessRunUntitled') }}
        </option>
      </select>
      <button
        type="button"
        class="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
        :disabled="!selectedRunId || loading"
        @click="loadTrace"
      >
        {{ t('workspace.harnessWaterfallLoad') }}
      </button>
    </div>

    <template v-if="spans.length">
      <div class="mt-4 overflow-x-auto" data-testid="harness-waterfall-tracks">
        <ol class="min-w-[28rem] space-y-1">
          <li
            v-for="span in spans"
            :key="span.id"
            class="flex items-center gap-2"
            :data-testid="`harness-waterfall-span-${span.type}`"
            :title="`${span.name} · ${span.status}${span.error ? ` · ${span.error}` : ''}`"
          >
            <span class="w-28 shrink-0 truncate text-[10.5px] text-[var(--text-secondary)]">
              {{ span.name }}
            </span>
            <div class="relative h-4 min-w-0 flex-1 rounded-[var(--radius-sm)] bg-[var(--bg-hover)]">
              <div
                class="absolute top-0.5 h-3 rounded-sm opacity-90"
                :class="statusTone[span.status] ?? 'bg-[var(--text-disabled)]'"
                :style="{ left: `${offset(span)}%`, width: `${width(span)}%` }"
              />
            </div>
            <span class="w-12 shrink-0 text-right text-[10px] tabular-nums text-[var(--text-tertiary)]">
              {{ durationLabel(span) }}
            </span>
          </li>
        </ol>
      </div>
      <p class="mt-2 flex items-center gap-1.5 text-[10.5px] text-[var(--text-tertiary)]">
        <Waves class="size-3" />
        {{ t('workspace.harnessWaterfallHint') }}
      </p>
    </template>
    <p v-else class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ t('workspace.harnessWaterfallEmpty') }}
    </p>
  </section>
</template>
