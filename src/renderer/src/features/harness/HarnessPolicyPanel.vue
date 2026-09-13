<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ShieldAlert } from '@lucide/vue'
import type {
  HarnessPolicyConfig,
  HarnessPolicyDecision,
  HarnessPolicyDomain
} from '@shared/types/harness'
import Select from '@renderer/components/ui/Select.vue'
import { useHarnessStore } from '@renderer/stores/harness'

type DecisionKey =
  | 'tools.default'
  | 'files.write'
  | 'files.delete'
  | 'files.rename'
  | 'files.outsideWorkspace'
  | 'shell.default'
  | 'git.commit'
  | 'git.push'
  | 'git.forcePush'
  | 'git.reset'
  | 'git.checkout'
  | 'git.branchDelete'
  | 'network'

const { t } = useI18n()
const harness = useHarnessStore()
const saving = ref(false)
const saveError = ref<string | null>(null)
const saved = ref(false)

const decisionRows: Array<{ key: DecisionKey; domain: HarnessPolicyDomain; labelKey: string }> = [
  { key: 'tools.default', domain: 'tool', labelKey: 'workspace.harnessPolicyToolDefault' },
  { key: 'files.write', domain: 'file', labelKey: 'workspace.harnessPolicyFilesWrite' },
  { key: 'files.delete', domain: 'file', labelKey: 'workspace.harnessPolicyFilesDelete' },
  { key: 'files.rename', domain: 'file', labelKey: 'workspace.harnessPolicyFilesRename' },
  {
    key: 'files.outsideWorkspace',
    domain: 'file',
    labelKey: 'workspace.harnessPolicyFilesOutside'
  },
  { key: 'shell.default', domain: 'shell', labelKey: 'workspace.harnessPolicyShellDefault' },
  { key: 'git.commit', domain: 'git', labelKey: 'workspace.harnessPolicyGitCommit' },
  { key: 'git.push', domain: 'git', labelKey: 'workspace.harnessPolicyGitPush' },
  { key: 'git.forcePush', domain: 'git', labelKey: 'workspace.harnessPolicyGitForcePush' },
  { key: 'git.reset', domain: 'git', labelKey: 'workspace.harnessPolicyGitReset' },
  { key: 'git.checkout', domain: 'git', labelKey: 'workspace.harnessPolicyGitCheckout' },
  { key: 'git.branchDelete', domain: 'git', labelKey: 'workspace.harnessPolicyGitBranchDelete' },
  { key: 'network', domain: 'network', labelKey: 'workspace.harnessPolicyNetwork' }
]

const budgetRows = [
  { key: 'maxTokens', labelKey: 'workspace.harnessPolicyMaxTokens', placeholder: '200000' },
  { key: 'maxCost', labelKey: 'workspace.harnessPolicyMaxCost', placeholder: '1.00' },
  { key: 'maxToolCalls', labelKey: 'workspace.harnessPolicyMaxToolCalls', placeholder: '100' },
  { key: 'maxRunDurationMs', labelKey: 'workspace.harnessPolicyMaxDuration', placeholder: '600000' }
] as const

type BudgetKey = (typeof budgetRows)[number]['key']
type Draft = HarnessPolicyConfig & { budgetText: Record<BudgetKey, string> }

const CUSTOM_STAGE_OPTIONS = [
  'static-check',
  'lint',
  'typecheck',
  'test',
  'build',
  'git-inspection',
  'custom-check'
] as const
const decisionOptions = computed(() => [
  { value: 'allow', label: t('workspace.harnessPolicyAllow') },
  { value: 'ask', label: t('workspace.harnessPolicyAsk') },
  { value: 'deny', label: t('workspace.harnessPolicyDeny') }
])
const evaluationPresetOptions = computed(() => [
  { value: 'fast', label: t('workspace.harnessPolicyEvalPresetFast') },
  { value: 'standard', label: t('workspace.harnessPolicyEvalPresetStandard') },
  { value: 'strict', label: t('workspace.harnessPolicyEvalPresetStrict') },
  { value: 'custom', label: t('workspace.harnessPolicyEvalPresetCustom') }
])

function toggleCustomStage(stage: (typeof CUSTOM_STAGE_OPTIONS)[number]): void {
  const stages = draft.evaluation.customStages
  const index = stages.indexOf(stage)
  if (index >= 0) stages.splice(index, 1)
  else stages.push(stage)
}

const draft = reactive<Draft>(emptyDraft())
let loadedFrom: HarnessPolicyConfig | null = null

const dirty = computed(() => {
  if (!loadedFrom) return false
  return JSON.stringify(toConfig(draft)) !== JSON.stringify(normalizeDraft(loadedFrom))
})

watch(
  () => harness.policy,
  (snapshot) => {
    if (!snapshot) return
    loadedFrom = snapshot.config
    applyDraft(draft, snapshot.config)
    saveError.value = null
  },
  { immediate: true }
)

function emptyDraft(): Draft {
  return {
    schemaVersion: 1,
    tools: { default: 'allow', overrides: {} },
    files: { write: 'allow', delete: 'ask', rename: 'allow', outsideWorkspace: 'deny' },
    shell: { default: 'allow', allowCommands: [], denyCommands: [], dangerousConfirmation: true },
    git: {
      commit: 'allow',
      push: 'ask',
      forcePush: 'deny',
      reset: 'ask',
      checkout: 'allow',
      branchDelete: 'deny'
    },
    network: 'ask',
    budget: { maxTokens: null, maxCost: null, maxToolCalls: null, maxRunDurationMs: null },
    evaluation: { autoEvaluate: true, preset: 'standard', customStages: [] },
    checkpoints: { autoPreRun: false },
    budgetText: { maxTokens: '', maxCost: '', maxToolCalls: '', maxRunDurationMs: '' }
  }
}

function normalizeDraft(config: HarnessPolicyConfig): HarnessPolicyConfig {
  return JSON.parse(JSON.stringify(config)) as HarnessPolicyConfig
}

function applyDraft(target: Draft, config: HarnessPolicyConfig): void {
  target.tools = { ...config.tools }
  target.files = { ...config.files }
  target.shell = { ...config.shell }
  target.git = { ...config.git }
  target.network = config.network
  target.budget = { ...config.budget }
  target.evaluation = { ...config.evaluation }
  target.checkpoints = { ...config.checkpoints }
  target.budgetText = {
    maxTokens: config.budget.maxTokens?.toString() ?? '',
    maxCost: config.budget.maxCost?.toString() ?? '',
    maxToolCalls: config.budget.maxToolCalls?.toString() ?? '',
    maxRunDurationMs: config.budget.maxRunDurationMs?.toString() ?? ''
  }
}

function toConfig(draftState: Draft): HarnessPolicyConfig {
  const number = (text: string): number | null => {
    const value = Number.parseFloat(text)
    return Number.isFinite(value) && value > 0 ? value : null
  }
  return {
    schemaVersion: 1,
    tools: { ...draftState.tools },
    files: { ...draftState.files },
    shell: {
      ...draftState.shell,
      allowCommands: draftState.shell.allowCommands.filter((item) => item.trim()),
      denyCommands: draftState.shell.denyCommands.filter((item) => item.trim())
    },
    git: { ...draftState.git },
    network: draftState.network,
    budget: {
      maxTokens: number(draftState.budgetText.maxTokens),
      maxCost: number(draftState.budgetText.maxCost),
      maxToolCalls: number(draftState.budgetText.maxToolCalls),
      maxRunDurationMs: number(draftState.budgetText.maxRunDurationMs)
    },
    evaluation: { ...draftState.evaluation },
    checkpoints: { ...draftState.checkpoints }
  }
}

function readDecision(key: DecisionKey): HarnessPolicyDecision {
  if (key === 'network') return draft.network
  const [group, field] = key.split('.')
  const record = draft as unknown as Record<string, Record<string, HarnessPolicyDecision>>
  return record[group]?.[field] ?? 'allow'
}

function writeDecision(key: DecisionKey, value: HarnessPolicyDecision): void {
  if (key === 'network') {
    draft.network = value
    return
  }
  const [group, field] = key.split('.')
  const record = draft as unknown as Record<string, Record<string, HarnessPolicyDecision>>
  if (record[group]) record[group][field] = value
}

function decisionTone(decision: HarnessPolicyDecision): 'success' | 'warning' | 'error' {
  if (decision === 'deny') return 'error'
  if (decision === 'ask') return 'warning'
  return 'success'
}

async function save(): Promise<void> {
  saving.value = true
  saveError.value = null
  try {
    await harness.savePolicy(toConfig(draft))
    saved.value = true
    setTimeout(() => (saved.value = false), 1500)
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    saving.value = false
  }
}

function patternListTitle(kind: 'allow' | 'deny'): string {
  return kind === 'allow'
    ? t('workspace.harnessPolicyAllowCommands')
    : t('workspace.harnessPolicyDenyCommands')
}
</script>

<template>
  <section class="harness-card max-w-4xl" data-testid="harness-policy-panel">
    <div class="flex items-center justify-between gap-2">
      <h3 class="harness-card-title">{{ $t('workspace.harnessPolicy') }}</h3>
      <button
        type="button"
        class="rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2.5 py-1 text-[11px] text-[var(--accent)] transition-colors hover:brightness-95 disabled:opacity-50"
        :disabled="!dirty || saving"
        data-testid="harness-policy-save"
        @click="save"
      >
        {{ saving ? $t('common.saving') : saved ? $t('common.saved') : $t('common.save') }}
      </button>
    </div>
    <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessPolicyHint') }}
    </p>

    <div v-if="harness.policy" class="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
      <label
        v-for="row in decisionRows"
        :key="row.key"
        class="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
      >
        <span class="min-w-0 truncate text-[11.5px] text-[var(--text-secondary)]">
          {{ $t(row.labelKey) }}
        </span>
        <Select
          class="w-[104px] shrink-0"
          size="sm"
          :model-value="readDecision(row.key)"
          :options="decisionOptions"
          :tone="decisionTone(readDecision(row.key))"
          :data-testid="`harness-policy-${row.key}`"
          @update:model-value="writeDecision(row.key, $event as HarnessPolicyDecision)"
        />
      </label>
    </div>

    <div v-if="harness.policy" class="mt-4">
      <p
        class="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
      >
        {{ $t('workspace.harnessPolicyBudget') }}
      </p>
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <label
          v-for="row in budgetRows"
          :key="row.key"
          class="harness-metric min-h-16 cursor-default"
        >
          <span>{{ $t(row.labelKey) }}</span>
          <input
            v-model="draft.budgetText[row.key]"
            type="number"
            min="0"
            step="any"
            :placeholder="$t('workspace.harnessPolicyUnlimited')"
            class="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-right text-[12px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:shadow-[var(--focus-ring)]"
            :data-testid="`harness-policy-budget-${row.key}`"
          />
        </label>
      </div>
      <p class="mt-1.5 text-[10.5px] text-[var(--text-tertiary)]">
        {{ $t('workspace.harnessPolicyBudgetHint') }}
      </p>
    </div>

    <div v-if="harness.policy" class="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
      <label
        class="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
      >
        <span class="text-[11.5px] text-[var(--text-secondary)]">
          {{ $t('workspace.harnessPolicyDangerousConfirmation') }}
        </span>
        <input
          v-model="draft.shell.dangerousConfirmation"
          type="checkbox"
          class="size-3.5 accent-[var(--accent)]"
        />
      </label>
      <label
        class="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
      >
        <span class="text-[11.5px] text-[var(--text-secondary)]">
          {{ $t('workspace.harnessPolicyAutoEvaluate') }}
        </span>
        <input
          v-model="draft.evaluation.autoEvaluate"
          type="checkbox"
          class="size-3.5 accent-[var(--accent)]"
        />
      </label>
      <div
        class="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
      >
        <span class="text-[11.5px] text-[var(--text-secondary)]">
          {{ $t('workspace.harnessPolicyEvalPreset') }}
        </span>
        <Select
          v-model="draft.evaluation.preset"
          class="w-[144px]"
          size="sm"
          :options="evaluationPresetOptions"
        />
      </div>
      <div
        v-if="draft.evaluation.preset === 'custom'"
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
      >
        <p class="text-[11.5px] text-[var(--text-secondary)]">
          {{ $t('workspace.harnessPolicyEvalCustomStages') }}
        </p>
        <div class="mt-2 grid grid-cols-2 gap-1.5">
          <label
            v-for="stage in CUSTOM_STAGE_OPTIONS"
            :key="stage"
            class="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"
          >
            <input
              :checked="draft.evaluation.customStages.includes(stage)"
              type="checkbox"
              class="size-3.5 accent-[var(--accent)]"
              @change="toggleCustomStage(stage)"
            />
            {{ $t(`workspace.harnessStage_${stage}`) }}
          </label>
        </div>
      </div>
      <label
        class="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
      >
        <span class="text-[11.5px] text-[var(--text-secondary)]">
          {{ $t('workspace.harnessPolicyAutoCheckpoint') }}
        </span>
        <input
          v-model="draft.checkpoints.autoPreRun"
          type="checkbox"
          class="size-3.5 accent-[var(--accent)]"
        />
      </label>
      <div
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
      >
        <p class="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
          <ShieldAlert class="size-3.5 text-[var(--warning)]" />
          {{ $t('workspace.harnessPolicyDangerousPatterns') }}
        </p>
        <p
          class="mt-1 line-clamp-3 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]"
        >
          {{ (harness.policy.dangerousPatterns ?? []).join(' · ') }}
        </p>
      </div>
    </div>

    <div v-if="harness.policy" class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div
        v-for="kind in ['allow', 'deny'] as const"
        :key="kind"
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
      >
        <p
          class="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
        >
          {{ patternListTitle(kind) }}
        </p>
        <textarea
          :value="
            (kind === 'allow' ? draft.shell.allowCommands : draft.shell.denyCommands).join('\n')
          "
          rows="4"
          :placeholder="$t('workspace.harnessPolicyPatternsPlaceholder')"
          class="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[10.5px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:shadow-[var(--focus-ring)]"
          :data-testid="`harness-policy-${kind}-commands`"
          @change="
            kind === 'allow'
              ? (draft.shell.allowCommands = ($event.target as HTMLTextAreaElement).value.split(
                  '\n'
                ))
              : (draft.shell.denyCommands = ($event.target as HTMLTextAreaElement).value.split(
                  '\n'
                ))
          "
        />
      </div>
    </div>

    <p v-if="saveError" role="alert" class="mt-3 text-[11px] text-[var(--error)]">
      {{ saveError }}
    </p>
  </section>
</template>
