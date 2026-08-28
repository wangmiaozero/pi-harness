<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Activity, RefreshCw } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import HarnessOverviewPanel from './HarnessOverviewPanel.vue'
import HarnessContextPanel from './HarnessContextPanel.vue'
import HarnessToolsPanel from './HarnessToolsPanel.vue'
import HarnessTimelinePanel from './HarnessTimelinePanel.vue'
import HarnessSessionPanel from './HarnessSessionPanel.vue'
import HarnessStatsPanel from './HarnessStatsPanel.vue'
import { useHarnessStore } from '@renderer/stores/harness'
import { useSessionStore } from '@renderer/stores/sessions'

type Section = 'overview' | 'context' | 'tools' | 'timeline' | 'session' | 'stats'

const { t } = useI18n()
const sessions = useSessionStore()
const harness = useHarnessStore()
const section = ref<Section>('overview')
const sections = computed<Array<{ id: Section; label: string }>>(() => [
  { id: 'overview', label: t('workspace.harnessOverview') },
  { id: 'context', label: t('workspace.harnessContext') },
  { id: 'tools', label: t('workspace.tools') },
  { id: 'timeline', label: t('workspace.harnessTimeline') },
  { id: 'session', label: t('workspace.harnessSession') },
  { id: 'stats', label: t('workspace.harnessStats') }
])

watch(
  () => sessions.currentId,
  (sessionId) => void harness.load(sessionId),
  { immediate: true }
)
</script>

<template>
  <div data-testid="harness-console" class="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
    <header
      class="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-5"
    >
      <div class="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          class="size-2 rounded-full"
          :class="
            harness.state?.runtime.status === 'running'
              ? 'bg-[var(--success)]'
              : 'bg-[var(--text-disabled)]'
          "
        />
        <div class="min-w-0">
          <h2
            class="text-[13px] font-semibold uppercase tracking-[0.09em] text-[var(--text-primary)]"
          >
            {{ $t('workspace.harnessTitle') }}
          </h2>
          <p class="truncate text-[10.5px] text-[var(--text-tertiary)]">
            {{
              harness.state
                ? `${harness.state.runtime.status} · ${harness.state.context?.percent?.toFixed(1) ?? '—'}% ${$t('workspace.harnessContext')}`
                : $t('workspace.harnessPoweredBy')
            }}
          </p>
        </div>
      </div>
      <IconButton
        :label="$t('common.refresh')"
        :disabled="!sessions.currentId || harness.loading"
        @click="harness.refresh"
      >
        <RefreshCw class="size-3.5" :class="harness.loading ? 'animate-spin' : ''" />
      </IconButton>
    </header>

    <nav
      v-if="sessions.currentId"
      class="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-4 py-1.5"
      :aria-label="$t('workspace.harnessSections')"
    >
      <button
        v-for="item in sections"
        :key="item.id"
        type="button"
        class="rounded-[var(--radius-sm)] border px-2.5 py-1 text-[11px] transition-colors"
        :class="
          section === item.id
            ? 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)]'
            : 'border-transparent text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        "
        :aria-pressed="section === item.id"
        @click="section = item.id"
      >
        {{ item.label }}
      </button>
    </nav>

    <div v-if="!sessions.currentId" class="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState
        :icon="Activity"
        :title="$t('workspace.harnessNoSession')"
        :description="$t('workspace.harnessNoSessionHint')"
      />
    </div>
    <div
      v-else-if="harness.loading && !harness.state"
      class="flex flex-1 items-center justify-center text-[12px] text-[var(--text-tertiary)]"
    >
      {{ $t('common.loading') }}
    </div>
    <div v-else class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      <div
        v-if="harness.error"
        role="alert"
        class="mb-3 rounded-[var(--radius-sm)] border border-[var(--error)] bg-[var(--error-tint)] px-3 py-2 text-[11.5px] text-[var(--error)]"
      >
        {{ harness.error }}
      </div>
      <template v-if="harness.state">
        <HarnessOverviewPanel v-if="section === 'overview'" :state="harness.state" />
        <HarnessContextPanel v-else-if="section === 'context'" :state="harness.state" />
        <HarnessToolsPanel v-else-if="section === 'tools'" :state="harness.state" />
        <HarnessTimelinePanel v-else-if="section === 'timeline'" :events="harness.timeline" />
        <HarnessSessionPanel
          v-else-if="section === 'session' && harness.session"
          :state="harness.state"
          :session="harness.session"
        />
        <HarnessStatsPanel v-else-if="section === 'stats'" :stats="harness.stats" />
      </template>
      <EmptyState
        v-else
        :icon="Activity"
        :title="$t('workspace.harnessUnavailable')"
        :description="$t('workspace.harnessUnavailableHint')"
      />
    </div>
  </div>
</template>
