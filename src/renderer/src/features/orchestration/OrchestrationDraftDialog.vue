<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOrchestrationStore, type OrchestrationDraft } from '@renderer/stores/orchestration'

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const store = useOrchestrationStore()

const draft = ref<OrchestrationDraft>({
  name: '',
  cwd: '',
  strategy: 'dependency',
  teamId: null,
  maxConcurrentAgents: 3,
  maxConcurrentRuns: 2,
  budgetMaxTokens: null,
  budgetMaxCost: null
})

async function submit(): Promise<void> {
  await store.createOrchestration({
    ...draft.value,
    cwd: draft.value.cwd.trim() || '.'
  })
  emit('close')
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    data-testid="orchestration-draft-dialog"
    @click.self="emit('close')"
  >
    <form
      class="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] p-4 shadow-xl"
      @submit.prevent="submit"
    >
      <h3 class="text-[13px] font-semibold text-[var(--text-primary)]">
        {{ t('orchestration.draftTitle') }}
      </h3>
      <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">
        {{ t('orchestration.draftHint') }}
      </p>

      <div class="mt-3 grid gap-2">
        <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
          {{ t('orchestration.draftName') }}
          <input
            v-model="draft.name"
            :placeholder="t('orchestration.draftNamePlaceholder')"
            class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
          />
        </label>
        <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
          {{ t('orchestration.draftCwd') }}
          <input
            v-model="draft.cwd"
            placeholder="."
            class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
          />
        </label>
        <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
          {{ t('orchestration.draftTeam') }}
          <select
            v-model="draft.teamId"
            class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
          >
            <option :value="null">{{ t('orchestration.draftNoTeam') }}</option>
            <option v-for="team in store.teams" :key="team.id" :value="team.id">
              {{ team.name }}
            </option>
          </select>
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
            {{ t('orchestration.draftStrategy') }}
            <select
              v-model="draft.strategy"
              class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
            >
              <option value="manual">manual</option>
              <option value="sequential">sequential</option>
              <option value="dependency">dependency</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
            {{ t('orchestration.draftConcurrency') }}
            <input
              v-model.number="draft.maxConcurrentAgents"
              type="number"
              min="1"
              max="16"
              class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
            />
          </label>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
            {{ t('orchestration.draftBudgetTokens') }}
            <input
              v-model.number="draft.budgetMaxTokens"
              type="number"
              min="0"
              placeholder="∞"
              class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
            />
          </label>
          <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
            {{ t('orchestration.draftBudgetCost') }}
            <input
              v-model.number="draft.budgetMaxCost"
              type="number"
              min="0"
              step="0.01"
              placeholder="∞"
              class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
            />
          </label>
        </div>
      </div>

      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
          @click="emit('close')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          type="submit"
          class="rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2.5 py-1 text-[11px] text-[var(--accent)] transition-colors hover:brightness-95 disabled:opacity-50"
          :disabled="store.mutating"
        >
          {{ t('orchestration.draftCreate') }}
        </button>
      </div>
    </form>
  </div>
</template>
