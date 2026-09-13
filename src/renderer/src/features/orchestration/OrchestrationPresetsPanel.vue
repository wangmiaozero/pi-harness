<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2 } from '@lucide/vue'
import { useOrchestrationStore } from '@renderer/stores/orchestration'
import { getApi } from '@renderer/composables/useApi'

const { t } = useI18n()
const store = useOrchestrationStore()

const showTeamForm = ref(false)
const teamForm = ref({ name: '' })

const showTemplateForm = ref(false)
const templateForm = ref({
  name: '',
  role: 'backend',
  description: '',
  modelId: ''
})

const templates = computed(() => store.templates)
const teams = computed(() => store.teams)

async function saveTeam(): Promise<void> {
  const name = teamForm.value.name.trim()
  if (!name) return
  store.mutating = true
  try {
    await getApi().orchestration.saveTeam({
      name,
      description: null,
      agentTemplateIds: []
    })
  } finally {
    store.mutating = false
  }
  showTeamForm.value = false
  teamForm.value = { name: '' }
  await store.refreshPresets()
}

async function removeTeam(teamId: string): Promise<void> {
  store.mutating = true
  try {
    await getApi().orchestration.deleteTeam(teamId)
  } finally {
    store.mutating = false
  }
  await store.refreshPresets()
}

async function saveTemplate(): Promise<void> {
  const name = templateForm.value.name.trim()
  if (!name) return
  store.mutating = true
  try {
    await getApi().orchestration.saveTemplate({
      name,
      role: templateForm.value.role.trim() || 'backend',
      description: templateForm.value.description.trim() || null,
      systemPrompt: null,
      provider: null,
      modelId: templateForm.value.modelId.trim() || null,
      thinkingLevel: null,
      toolNames: null,
      skillIds: [],
      workspaceMode: 'shared',
      isReviewer: false
    })
  } finally {
    store.mutating = false
  }
  showTemplateForm.value = false
  templateForm.value = { name: '', role: 'backend', description: '', modelId: '' }
  await store.refreshPresets()
}

async function removeTemplate(templateId: string): Promise<void> {
  store.mutating = true
  try {
    await getApi().orchestration.deleteTemplate(templateId)
  } finally {
    store.mutating = false
  }
  await store.refreshPresets()
}
</script>

<template>
  <div class="space-y-4">
    <section class="harness-card" data-testid="orchestration-teams-panel">
      <div class="flex items-center justify-between gap-2">
        <h3 class="harness-card-title">{{ t('orchestration.teamsTitle') }}</h3>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-1 text-[11px] text-[var(--accent)] transition-colors hover:brightness-95 disabled:opacity-50"
          :disabled="store.mutating"
          @click="showTeamForm = !showTeamForm"
        >
          <Plus class="size-3" />
          {{ t('orchestration.teamAdd') }}
        </button>
      </div>
      <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">{{ t('orchestration.teamsHint') }}</p>

      <form
        v-if="showTeamForm"
        class="mt-3 flex items-end gap-2"
        @submit.prevent="saveTeam"
      >
        <label class="flex flex-1 flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
          {{ t('orchestration.teamName') }}
          <input
            v-model="teamForm.name"
            required
            class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[11.5px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:shadow-[var(--focus-ring)]"
          />
        </label>
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
          @click="showTeamForm = false"
        >
          {{ t('common.cancel') }}
        </button>
      </form>

      <p v-if="!teams.length" class="mt-4 text-[12px] text-[var(--text-tertiary)]">
        {{ t('orchestration.teamsEmpty') }}
      </p>
      <ul v-else class="mt-3 space-y-2">
        <li
          v-for="team in teams"
          :key="team.id"
          class="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
        >
          <div class="min-w-0">
            <p class="text-[11.5px] font-medium text-[var(--text-primary)]">
              {{ team.name }}
            </p>
            <p class="text-[10.5px] text-[var(--text-tertiary)]">
              {{ team.agentTemplateIds.length }} {{ t('orchestration.teamRolesCount') }}
            </p>
          </div>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[10.5px] text-[var(--error)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="store.mutating"
            @click="removeTeam(team.id)"
          >
            <Trash2 class="size-3" />
            {{ t('common.delete') }}
          </button>
        </li>
      </ul>
    </section>

    <section class="harness-card" data-testid="orchestration-templates-panel">
      <div class="flex items-center justify-between gap-2">
        <h3 class="harness-card-title">{{ t('orchestration.templatesTitle') }}</h3>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-1 text-[11px] text-[var(--accent)] transition-colors hover:brightness-95 disabled:opacity-50"
          :disabled="store.mutating"
          @click="showTemplateForm = !showTemplateForm"
        >
          <Plus class="size-3" />
          {{ t('orchestration.templateAdd') }}
        </button>
      </div>
      <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">{{ t('orchestration.templatesHint') }}</p>

      <form
        v-if="showTemplateForm"
        class="mt-3 grid gap-2 sm:grid-cols-2"
        @submit.prevent="saveTemplate"
      >
        <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
          {{ t('orchestration.templateName') }}
          <input
            v-model="templateForm.name"
            required
            class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[11.5px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:shadow-[var(--focus-ring)]"
          />
        </label>
        <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
          {{ t('orchestration.agentRole') }}
          <input
            v-model="templateForm.role"
            class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[11.5px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:shadow-[var(--focus-ring)]"
          />
        </label>
        <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)] sm:col-span-2">
          {{ t('orchestration.templateDescription') }}
          <textarea
            v-model="templateForm.description"
            rows="2"
            class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[11.5px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:shadow-[var(--focus-ring)]"
          />
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
            @click="showTemplateForm = false"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </form>

      <p v-if="!templates.length" class="mt-4 text-[12px] text-[var(--text-tertiary)]">
        {{ t('orchestration.templatesEmpty') }}
      </p>
      <ul v-else class="mt-3 space-y-2">
        <li
          v-for="template in templates"
          :key="template.id"
          class="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
        >
          <div class="min-w-0">
            <p class="text-[11.5px] font-medium text-[var(--text-primary)]">
              {{ template.name }}
            </p>
            <p class="text-[10.5px] text-[var(--text-tertiary)]">
              {{ template.role }}<template v-if="template.modelId"> · {{ template.modelId }}</template>
              <template v-if="template.isReviewer"> · {{ t('orchestration.agentReviewer') }}</template>
            </p>
            <p v-if="template.description" class="text-[10.5px] text-[var(--text-tertiary)]">
              {{ template.description }}
            </p>
          </div>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[10.5px] text-[var(--error)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="store.mutating"
            @click="removeTemplate(template.id)"
          >
            <Trash2 class="size-3" />
            {{ t('common.delete') }}
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
