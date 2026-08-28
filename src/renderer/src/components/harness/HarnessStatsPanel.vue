<script setup lang="ts">
import type { HarnessStats } from '@shared/types/harness'

defineProps<{ stats: HarnessStats | null }>()
</script>

<template>
  <section class="harness-card max-w-4xl">
    <h3 class="harness-card-title">{{ $t('workspace.harnessStats') }}</h3>
    <div v-if="stats" class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      <div
        v-for="metric in [
          [$t('workspace.messages'), stats.totalMessages],
          [$t('workspace.messageUser'), stats.userMessages],
          [$t('workspace.messageAssistant'), stats.assistantMessages],
          [$t('workspace.toolCalls'), stats.toolCalls],
          [$t('workspace.toolResults'), stats.toolResults],
          [$t('workspace.harnessActiveTools'), stats.activeTools],
          [$t('workspace.harnessPending'), stats.pendingMessages],
          [$t('workspace.tokenInput'), stats.tokens?.input],
          [$t('workspace.tokenOutput'), stats.tokens?.output],
          [$t('workspace.cacheRead'), stats.tokens?.cacheRead],
          [$t('workspace.total'), stats.tokens?.total]
        ]"
        :key="String(metric[0])"
        class="harness-metric min-h-16"
      >
        <span>{{ metric[0] }}</span>
        <strong>{{ typeof metric[1] === 'number' ? metric[1].toLocaleString() : '—' }}</strong>
      </div>
      <div v-if="stats.cost !== undefined" class="harness-metric min-h-16">
        <span>{{ $t('workspace.harnessCost') }}</span>
        <strong>${{ stats.cost.toFixed(4) }}</strong>
      </div>
    </div>
    <p v-else class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessStatsUnavailable') }}
    </p>
  </section>
</template>
