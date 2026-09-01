<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Minus, Plus, Sparkles } from '@lucide/vue'
import Button from '@renderer/components/ui/Button.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import Textarea from '@renderer/components/ui/Textarea.vue'
import { callApi, getApi, getErrorPayload } from '@renderer/composables/useApi'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useModelsStore } from '@renderer/stores/models'
import type { GitFileStatus } from '@shared/types/workspace'

const emit = defineEmits<{ 'open-diff': [] }>()
const { t } = useI18n()
const workspace = useWorkspaceStore()
const models = useModelsStore()
const message = ref('')
const mutating = ref(false)
const generating = ref(false)
const committing = ref(false)

const repository = computed(() => workspace.gitStatus?.repositoryRoot ?? null)
const files = computed(() => workspace.gitStatus?.files ?? [])
const staged = computed(() =>
  files.value.filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?')
)
const unstaged = computed(() =>
  files.value.filter((file) => file.worktreeStatus !== ' ' || file.indexStatus === '?')
)
const conflicted = computed(() => files.value.some((file) => file.status === 'conflict'))
const activeModel = computed(() => {
  const provider = models.active.providerKey
  const model = models.active.modelId
  return provider && model ? `${provider}/${model}` : t('workspace.gitNoActiveModel')
})

function openDiff(file: GitFileStatus) {
  workspace.openDiffTab(file.filePath, `Diff: ${workspace.displayFilePath(file.filePath)}`)
  emit('open-diff')
}

async function mutate(action: 'stage' | 'unstage', targets: GitFileStatus[]) {
  const cwd = repository.value
  if (!cwd || !targets.length || mutating.value) return
  mutating.value = true
  try {
    await callApi(() =>
      getApi().git[action](
        cwd,
        targets.map((file) => file.filePath)
      )
    )
    await workspace.refreshContent()
  } catch (error) {
    toast.error(getErrorPayload(error).message)
  } finally {
    mutating.value = false
  }
}

async function generate() {
  const cwd = repository.value
  if (!cwd || !staged.value.length || generating.value) return
  generating.value = true
  try {
    const result = await callApi(() => getApi().git.generateCommitMessage(cwd, message.value))
    message.value = result.message
    toast.success(t('workspace.gitMessageGenerated'))
  } catch (error) {
    toast.error(getErrorPayload(error).message)
  } finally {
    generating.value = false
  }
}

async function commit() {
  const cwd = repository.value
  const value = message.value.trim()
  if (!cwd || !value || !staged.value.length || conflicted.value || committing.value) return
  committing.value = true
  try {
    const result = await callApi(() => getApi().git.commit(cwd, value))
    message.value = ''
    await workspace.refreshContent()
    toast.success(t('workspace.gitCommitted', { hash: result.hash.slice(0, 7) }))
  } catch (error) {
    toast.error(getErrorPayload(error).message)
  } finally {
    committing.value = false
  }
}
</script>

<template>
  <div class="border-t border-[var(--border-subtle)] px-2 pb-2 pt-2" data-testid="git-commit-panel">
    <section>
      <div class="mb-1 flex items-center gap-1.5 px-1">
        <span class="text-[10.5px] font-medium text-[var(--text-secondary)]">
          {{ $t('workspace.gitStaged') }}
        </span>
        <span class="text-[10px] text-[var(--text-tertiary)]">{{ staged.length }}</span>
        <button
          v-if="staged.length"
          type="button"
          class="ml-auto text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          :disabled="mutating"
          @click="mutate('unstage', staged)"
        >
          {{ $t('workspace.gitUnstageAll') }}
        </button>
      </div>
      <p v-if="!staged.length" class="px-1 pb-1 text-[10px] text-[var(--text-disabled)]">
        {{ $t('workspace.gitNothingStaged') }}
      </p>
      <div
        v-for="file in staged"
        :key="`staged-${file.filePath}`"
        class="group flex min-w-0 items-center rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)]"
      >
        <button
          type="button"
          class="min-w-0 flex-1 truncate px-1.5 py-1 text-left text-[11px] text-[var(--text-secondary)]"
          :title="workspace.displayFilePath(file.filePath)"
          @click="openDiff(file)"
        >
          {{ workspace.displayFilePath(file.filePath) }}
        </button>
        <span class="text-[9.5px] text-[var(--text-tertiary)]">{{ file.indexStatus }}</span>
        <IconButton
          :label="$t('workspace.gitUnstage')"
          :disabled="mutating"
          @click="mutate('unstage', [file])"
        >
          <Minus class="size-3" />
        </IconButton>
      </div>
    </section>

    <section class="mt-1.5 border-t border-[var(--border-subtle)] pt-1.5">
      <div class="mb-1 flex items-center gap-1.5 px-1">
        <span class="text-[10.5px] font-medium text-[var(--text-secondary)]">
          {{ $t('workspace.gitUnstaged') }}
        </span>
        <span class="text-[10px] text-[var(--text-tertiary)]">{{ unstaged.length }}</span>
        <button
          v-if="unstaged.length"
          type="button"
          class="ml-auto text-[10px] text-[var(--accent)] hover:text-[var(--accent-hover)]"
          :disabled="mutating"
          @click="mutate('stage', unstaged)"
        >
          {{ $t('workspace.gitStageAll') }}
        </button>
      </div>
      <div
        v-for="file in unstaged"
        :key="`unstaged-${file.filePath}`"
        class="group flex min-w-0 items-center rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)]"
      >
        <button
          type="button"
          class="min-w-0 flex-1 truncate px-1.5 py-1 text-left text-[11px] text-[var(--text-secondary)]"
          :title="workspace.displayFilePath(file.filePath)"
          @click="openDiff(file)"
        >
          {{ workspace.displayFilePath(file.filePath) }}
        </button>
        <span class="text-[9.5px] text-[var(--text-tertiary)]">{{ file.worktreeStatus }}</span>
        <IconButton
          :label="$t('workspace.gitStage')"
          :disabled="mutating"
          @click="mutate('stage', [file])"
        >
          <Plus class="size-3" />
        </IconButton>
      </div>
    </section>

    <div class="mt-2 border-t border-[var(--border-subtle)] pt-2">
      <Textarea
        v-model="message"
        :rows="4"
        :placeholder="$t('workspace.gitCommitPlaceholder')"
        :disabled="generating || committing"
        class="max-h-40 min-h-20 resize-y"
      />
      <div class="mt-1 flex min-w-0 items-center gap-1">
        <span
          class="min-w-0 flex-1 truncate text-[9.5px] text-[var(--text-tertiary)]"
          :title="activeModel"
        >
          {{ activeModel }}
        </span>
        <Button
          size="sm"
          variant="ghost"
          :loading="generating"
          :disabled="!staged.length || conflicted"
          :title="$t('workspace.gitGenerateHint')"
          data-testid="git-generate-message"
          @click="generate"
        >
          <Sparkles class="size-3 text-[var(--accent)]" />
          {{ $t('workspace.gitGenerate') }}
        </Button>
      </div>
      <p v-if="conflicted" class="mt-1 text-[10px] leading-snug text-[var(--error)]">
        {{ $t('workspace.gitResolveConflicts') }}
      </p>
      <Button
        class="mt-1.5 w-full"
        variant="primary"
        :loading="committing"
        :disabled="!message.trim() || !staged.length || conflicted"
        data-testid="git-create-commit"
        @click="commit"
      >
        {{ $t('workspace.gitCommitCount', { count: staged.length }) }}
      </Button>
    </div>
  </div>
</template>
