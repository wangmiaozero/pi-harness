<script setup lang="ts">
import { Check, CheckCheck, ChevronDown, ListX, RefreshCw, ShieldCheck } from '@lucide/vue'
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@renderer/components/ui/Button.vue'
import SearchField from '@renderer/components/ui/SearchField.vue'
import type { ToolEntry } from '@shared/workspace/tool-presets'

const { t } = useI18n()
const props = defineProps<{
  tools: ToolEntry[]
  saved: string[]
  loading: boolean
  ready: boolean
  applying: boolean
  busy: boolean
  error: string | null
  refresh: () => Promise<boolean>
}>()
const emit = defineEmits<{ apply: [names: string[]] }>()
const query = ref('')
const search = ref<InstanceType<typeof SearchField> | null>(null)
const expanded = ref<string | null>(null)
const listId = useId()
defineExpose({ focusSearch: () => search.value?.focus() })
const registered = computed(() => new Set(props.tools.map(({ name }) => name)))
const missing = computed(() => props.saved.filter((name) => !registered.value.has(name)))
const active = computed(() => props.tools.filter((tool) => tool.active).map((tool) => tool.name))
const manageable = computed(() => props.tools.filter((tool) => tool.available !== false))
const manageableNames = computed(() => new Set(manageable.value.map((tool) => tool.name)))
const filtered = computed(() => {
  const text = query.value.trim().toLowerCase()
  return [
    ...props.tools,
    ...missing.value.map((name) => ({
      name,
      description: '',
      active: false,
      available: false,
      source: undefined
    }))
  ].filter(
    (tool) =>
      tool.name.toLowerCase().includes(text) || tool.description.toLowerCase().includes(text)
  )
})
const disabled = computed(() => !props.ready || props.loading || props.applying || props.busy)
const selection = computed(() => [
  ...active.value,
  ...props.saved.filter((name) => !manageableNames.value.has(name))
])
const refreshLabels = {
  idle: 'workspace.toolsRefresh',
  refreshing: 'workspace.toolsRefreshing',
  refreshed: 'workspace.toolsRefreshed',
  failed: 'workspace.toolsRefreshRetry'
} as const
const refreshState = ref<keyof typeof refreshLabels>('idle')
const refreshDisabled = computed(
  () => props.loading || props.applying || refreshState.value === 'refreshing'
)

watch(refreshState, (state, _, onCleanup) => {
  if (state !== 'refreshed') return
  const timer = window.setTimeout(() => (refreshState.value = 'idle'), 1800)
  onCleanup(() => window.clearTimeout(timer))
})

async function refreshTools() {
  if (refreshDisabled.value) return
  refreshState.value = 'refreshing'
  const refreshed = await props.refresh().catch(() => false)
  refreshState.value = refreshed ? 'refreshed' : 'failed'
}

function selectAll() {
  emit('apply', [...new Set([...props.saved, ...manageableNames.value])])
}

function toggle(tool: ToolEntry) {
  if (disabled.value || tool.available === false) return
  emit(
    'apply',
    tool.active
      ? selection.value.filter((name) => name !== tool.name)
      : [...selection.value, tool.name]
  )
}
</script>

<template>
  <div class="flex h-[min(58vh,30rem)] min-h-0 w-full flex-col gap-2.5 text-[13px]">
    <div class="flex shrink-0 items-center gap-3">
      <SearchField
        ref="search"
        v-model="query"
        :placeholder="t('workspace.toolsSearch')"
        class="min-w-0 flex-1"
      />
      <span
        v-if="ready || applying"
        role="status"
        class="shrink-0 rounded-full bg-[var(--accent-tint-soft)] px-2.5 py-1 text-[12px] font-medium tabular-nums text-[var(--text-primary)]"
      >
        {{
          applying
            ? t('workspace.toolsApplying')
            : t('workspace.toolsActiveCount', { count: active.length })
        }}
      </span>
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        :disabled="disabled || manageable.every((tool) => tool.active)"
        @click="selectAll"
      >
        <CheckCheck aria-hidden="true" class="size-3.5" />
        {{ t('workspace.toolsSelectAll') }}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        :disabled="disabled || !selection.length"
        @click="emit('apply', [])"
      >
        <ListX aria-hidden="true" class="size-3.5" />
        {{ t('workspace.toolsClear') }}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="ml-auto aria-disabled:cursor-wait aria-disabled:opacity-65"
        :aria-disabled="refreshDisabled || undefined"
        :aria-busy="refreshState === 'refreshing' || undefined"
        @click="refreshTools"
      >
        <Check
          v-if="refreshState === 'refreshed'"
          aria-hidden="true"
          class="size-3.5 text-[var(--success)] motion-safe:animate-[pi-fade-in_var(--motion-base)_var(--ease-out)]"
        />
        <RefreshCw
          v-else
          aria-hidden="true"
          class="size-3.5"
          :class="{ 'motion-safe:animate-spin': refreshState === 'refreshing' }"
        />
        <span aria-live="polite">{{ t(refreshLabels[refreshState]) }}</span>
      </Button>
    </div>
    <p
      v-if="error"
      role="alert"
      class="shrink-0 rounded-[var(--radius-sm)] bg-[var(--error-tint)] px-3 py-2 text-[var(--error)]"
    >
      {{ error }}
    </p>
    <div
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      :aria-busy="loading || applying"
    >
      <p
        v-if="loading && !ready"
        role="status"
        class="p-4 text-center text-[var(--text-secondary)]"
      >
        {{ t('common.loading') }}
      </p>
      <p v-else-if="ready && !filtered.length" class="p-4 text-center text-[var(--text-secondary)]">
        {{ t('workspace.toolsEmpty') }}
      </p>
      <ul v-if="ready && filtered.length" class="divide-y divide-[var(--border-subtle)]">
        <li
          v-for="(tool, index) in filtered"
          :key="tool.name"
          class="flex items-start gap-2 px-3 py-2 transition-colors hover:bg-[var(--bg-hover)]"
          :class="{ 'bg-[var(--bg-hover)]': expanded === tool.name }"
        >
          <label
            class="flex min-w-0 flex-1 items-start gap-2.5"
            :class="{ 'cursor-pointer': tool.available !== false }"
          >
            <span class="relative mt-0.5 flex size-4 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                :aria-label="tool.name"
                :checked="tool.active"
                :disabled="tool.available === false"
                :aria-disabled="disabled || undefined"
                class="tool-checkbox size-4 rounded-[4px] border border-[var(--control-border)] bg-[var(--control-bg)] checked:border-[var(--accent-solid)] checked:bg-[var(--accent-solid)] aria-disabled:opacity-50 disabled:opacity-50"
                @click.prevent="toggle(tool)"
              />
              <Check
                v-if="tool.active"
                aria-hidden="true"
                class="pointer-events-none absolute size-3 text-white"
                :stroke-width="2.5"
              />
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex min-w-0 flex-wrap items-center gap-x-2">
                <span class="min-w-0 truncate font-mono font-medium text-[var(--text-primary)]">{{
                  tool.name
                }}</span>
                <span
                  v-if="registered.has(tool.name)"
                  class="rounded bg-[var(--accent-tint-soft)] px-1.5 text-[11px] text-[var(--text-secondary)]"
                  >{{ t(`workspace.toolSource.${tool.source ?? 'other'}`) }}</span
                >
                <span
                  v-if="tool.available === false"
                  class="text-[11px] text-[var(--text-secondary)]"
                >
                  {{
                    t(
                      registered.has(tool.name)
                        ? 'workspace.toolsUnavailable'
                        : 'workspace.toolsUnregistered'
                    )
                  }}
                </span>
              </span>
              <span
                v-if="tool.description"
                :id="`${listId}-description-${index}`"
                class="block text-[12px] leading-relaxed text-[var(--text-secondary)]"
                :class="
                  expanded === tool.name ? 'mt-1 whitespace-pre-wrap break-words' : 'truncate'
                "
                >{{ tool.description }}</span
              >
            </span>
          </label>
          <button
            v-if="tool.description"
            type="button"
            class="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)]"
            :aria-label="t('workspace.toolsDescription', { name: tool.name })"
            :aria-controls="`${listId}-description-${index}`"
            :aria-expanded="expanded === tool.name"
            @click="expanded = expanded === tool.name ? null : tool.name"
          >
            <ChevronDown
              aria-hidden="true"
              class="size-3.5 transition-transform"
              :class="{ 'rotate-180': expanded === tool.name }"
            />
          </button>
        </li>
      </ul>
    </div>
    <p class="flex shrink-0 items-start gap-2 px-0.5 pt-0.5 text-xs text-[var(--text-secondary)]">
      <ShieldCheck aria-hidden="true" class="mt-px size-3.5 shrink-0" />
      {{ t('workspace.toolsAutoSave') }}
    </p>
  </div>
</template>

<style scoped>
.tool-checkbox {
  appearance: none;
}
</style>
