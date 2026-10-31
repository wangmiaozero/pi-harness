<script setup lang="ts">
import { computed } from 'vue'
import type { HarnessState } from '@shared/types/harness'

const props = defineProps<{ state: HarnessState }>()
const percent = computed(() => props.state.context?.percent ?? 0)
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
    </div>
  </section>
</template>
