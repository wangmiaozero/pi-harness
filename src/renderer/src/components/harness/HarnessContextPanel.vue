<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import type { HarnessState } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'

const props = defineProps<{ state: HarnessState }>()
const harness = useHarnessStore()
const { t } = useI18n()
const instructions = ref('')
const percent = computed(() => props.state.context?.percent ?? 0)

async function toggleAutoCompaction() {
  try {
    await harness.setAutoCompaction(!props.state.compaction.auto)
  } catch {
    /* Store exposes the sanitized error. */
  }
}

async function compactNow() {
  try {
    const result = (await harness.compact(instructions.value.trim() || undefined)) as {
      reason?: 'session-too-small' | 'already-compacted'
    } | null
    if (result?.reason === 'session-too-small') toast.info(t('workspace.compactUnavailable'))
    if (result?.reason === 'already-compacted') toast.info(t('workspace.compactAlready'))
  } catch {
    /* Store exposes the sanitized error. */
  }
}
</script>

<template>
  <section class="harness-card max-w-3xl">
    <div class="flex items-center justify-between">
      <h3 class="harness-card-title">{{ $t('workspace.harnessContext') }}</h3>
      <span class="font-mono text-[12px] text-[var(--accent)]">
        {{
          state.context?.percent === null || !state.context
            ? '—'
            : `${state.context.percent.toFixed(1)}%`
        }}
      </span>
    </div>

    <template v-if="state.context">
      <p class="mt-4 font-mono text-[18px] text-[var(--text-primary)]">
        {{ state.context.tokens?.toLocaleString() ?? '—' }} /
        {{ state.context.contextWindow.toLocaleString() }}
        <span class="text-[11px] text-[var(--text-tertiary)]">tokens</span>
      </p>
      <div
        class="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-surface)]"
        role="progressbar"
        :aria-valuenow="state.context.percent ?? undefined"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="h-full rounded-full bg-[var(--accent)] transition-[width]"
          :style="{ width: `${percent}%` }"
        />
      </div>
    </template>
    <p v-else class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessContextUnavailable') }}
    </p>

    <div class="mt-5 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
      <div>
        <p class="text-[12px] text-[var(--text-primary)]">
          {{ $t('workspace.harnessAutoCompaction') }}
        </p>
        <p class="text-[10.5px] text-[var(--text-tertiary)]">
          {{
            state.compaction.running
              ? $t('workspace.harnessCompacting')
              : $t('workspace.harnessNotCompacting')
          }}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        data-testid="harness-auto-compaction"
        class="h-7 rounded-full border px-3 text-[11px] font-medium"
        :class="
          state.compaction.auto
            ? 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)]'
            : 'border-[var(--border-default)] text-[var(--text-tertiary)]'
        "
        :aria-checked="state.compaction.auto"
        :disabled="harness.mutating || !state.capabilities.autoCompaction"
        @click="toggleAutoCompaction"
      >
        {{ state.compaction.auto ? 'ON' : 'OFF' }}
      </button>
    </div>

    <textarea
      v-model="instructions"
      class="harness-textarea mt-4"
      rows="4"
      :placeholder="$t('workspace.harnessCompactionInstructions')"
      :disabled="harness.mutating || !state.capabilities.compaction"
    />
    <div class="mt-2 flex gap-2">
      <button
        type="button"
        class="harness-action-button"
        :disabled="harness.mutating || state.compaction.running || !state.capabilities.compaction"
        @click="compactNow"
      >
        {{ $t('workspace.harnessCompactNow') }}
      </button>
      <button
        v-if="state.compaction.running"
        type="button"
        class="harness-danger-button"
        :disabled="harness.mutating"
        @click="harness.abortCompaction().catch(() => undefined)"
      >
        {{ $t('workspace.harnessAbortCompaction') }}
      </button>
    </div>
  </section>
</template>
