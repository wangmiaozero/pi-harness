<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot, Plus, Trash2 } from '@lucide/vue'
import { useOrchestrationStore } from '@renderer/stores/orchestration'
import type { HarnessAgentSnapshot } from '@shared/types/harness'

const { t } = useI18n()
const store = useOrchestrationStore()

const showForm = ref(false)
const form = ref({
  name: '',
  role: 'backend',
  description: '',
  templateId: '' as string,
  provider: '',
  modelId: '',
  thinkingLevel: '',
  isReviewer: false,
  workspaceMode: 'shared' as 'shared' | 'worktree',
  budgetTokens: '' as string
})

const agents = computed<HarnessAgentSnapshot[]>(() => store.snapshot?.agents ?? [])

const statusTone: Record<string, string> = {
  idle: 'text-[var(--text-tertiary)]',
  queued: 'text-[var(--warning)]',
  running: 'text-[var(--success)]',
  blocked: 'text-[var(--error)]'
}

async function submit(): Promise<void> {
  const tokens = form.value.budgetTokens.trim()
  await store.addAgent({
    name: form.value.name.trim() || 'Agent',
    role: form.value.role.trim() || 'backend',
    description: form.value.description.trim() || null,
    provider: form.value.provider.trim() || null,
    modelId: form.value.modelId.trim() || null,
    thinkingLevel: form.value.thinkingLevel.trim() || null,
    workspaceMode: form.value.workspaceMode,
    isReviewer: form.value.isReviewer,
    templateId: form.value.templateId || null,
    budget: {
      maxTokens: tokens ? Number(tokens) : null,
      maxCost: null
    }
  })
  showForm.value = false
  form.value = {
    name: '',
    role: 'backend',
    description: '',
    templateId: '',
    provider: '',
    modelId: '',
    thinkingLevel: '',
    isReviewer: false,
    workspaceMode: 'shared',
    budgetTokens: ''
  }
}

async function removeAgent(agentId: string): Promise<void> {
  await store.deleteAgent(agentId)
}
</script>

<template>
  <section class="harness-card" data-testid="orchestration-agents-panel">
    <div class="flex items-center justify-between gap-2">
      <h3 class="harness-card-title">{{ t('orchestration.agentsTitle') }}</h3>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-1 text-[11px] text-[var(--accent)] transition-colors hover:brightness-95 disabled:opacity-50"
        :disabled="!store.currentId || store.mutating"
        data-testid="orchestration-agent-add"
        @click="showForm = !showForm"
      >
        <Plus class="size-3" />
        {{ t('orchestration.agentAdd') }}
      </button>
    </div>
    <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">{{ t('orchestration.agentsHint') }}</p>

    <form
      v-if="showForm"
      class="mt-3 grid gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:grid-cols-2"
      data-testid="orchestration-agent-form"
      @submit.prevent="submit"
    >
      <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('orchestration.agentName') }}
        <input
          v-model="form.name"
          required
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('orchestration.agentRole') }}
        <input
          v-model="form.role"
          required
          :placeholder="t('orchestration.agentRolePlaceholder')"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('orchestration.agentTemplate') }}
        <select
          v-model="form.templateId"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
        >
          <option value="">{{ t('orchestration.agentNoTemplate') }}</option>
          <option v-for="template in store.templates" :key="template.id" :value="template.id">
            {{ template.name }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('orchestration.agentModel') }}
        <input
          v-model="form.modelId"
          :placeholder="t('orchestration.agentModelPlaceholder')"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('orchestration.agentBudget') }}
        <input
          v-model="form.budgetTokens"
          type="number"
          min="0"
          :placeholder="t('orchestration.agentBudgetPlaceholder')"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
        />
      </label>
      <label class="flex items-center gap-2 pt-4 text-[10.5px] text-[var(--text-secondary)]">
        <input v-model="form.isReviewer" type="checkbox" class="size-3" />
        {{ t('orchestration.agentReviewer') }}
      </label>
      <div class="flex items-center gap-2 sm:col-span-2">
        <button
          type="submit"
          class="rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2.5 py-1 text-[11px] text-[var(--accent)]"
          :disabled="store.mutating"
        >
          {{ t('common.save') }}
        </button>
        <button
          type="button"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
          @click="showForm = false"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </form>

    <p v-if="!agents.length" class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ t('orchestration.agentsEmpty') }}
    </p>

    <ul v-else class="mt-3 space-y-2">
      <li
        v-for="snapshot in agents"
        :key="snapshot.agent.id"
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        data-testid="orchestration-agent-card"
      >
        <div class="flex flex-wrap items-center gap-2 text-[11.5px]">
          <Bot class="size-3.5 text-[var(--text-tertiary)]" />
          <span class="font-medium text-[var(--text-primary)]">{{ snapshot.agent.name }}</span>
          <span
            class="rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px]"
            :class="statusTone[snapshot.agent.status]"
          >
            {{ snapshot.agent.status }}
          </span>
          <span class="rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
            {{ snapshot.agent.role }}
          </span>
          <span
            v-if="snapshot.agent.isReviewer"
            class="rounded-full border border-[var(--accent-border)] bg-[var(--accent-tint)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]"
          >
            {{ t('orchestration.agentReviewer') }}
          </span>
          <span
            v-if="snapshot.agent.workspaceMode === 'worktree'"
            class="rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-tertiary)]"
          >
            {{ snapshot.agent.worktreeBranch ?? 'worktree' }}
          </span>
          <span v-if="snapshot.possiblyStuck" class="text-[10px] text-[var(--warning)]">
            {{ t('orchestration.agentStuck') }}
          </span>
        </div>
        <div class="mt-1.5 flex flex-wrap items-center gap-3 text-[10.5px] text-[var(--text-tertiary)]">
          <span>runs: {{ snapshot.runCount }}</span>
          <span>tokens: {{ snapshot.totalTokens.toLocaleString() }}</span>
          <span v-if="snapshot.estimatedCost !== null">
            cost: ${{ snapshot.estimatedCost.toFixed(3) }}
          </span>
          <span>tools: {{ snapshot.toolCalls }}</span>
          <span :class="snapshot.failures > 0 ? 'text-[var(--error)]' : ''">
            failures: {{ snapshot.failures }}
          </span>
          <span v-if="snapshot.agent.budget.maxTokens !== null">
            {{ t('orchestration.agentBudget') }}: {{ snapshot.agent.budget.maxTokens }}
          </span>
        </div>
        <div class="mt-2 flex items-center justify-between gap-2">
          <p v-if="snapshot.agent.description" class="text-[10.5px] text-[var(--text-tertiary)]">
            {{ snapshot.agent.description }}
          </p>
          <button
            type="button"
            class="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[10.5px] text-[var(--error)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="store.mutating"
            @click="removeAgent(snapshot.agent.id)"
          >
            <Trash2 class="size-3" />
            {{ t('common.delete') }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
