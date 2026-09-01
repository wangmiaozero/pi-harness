<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'
import type { WorktreeInfo } from '@shared/types/workspace'
import { toast } from 'vue-sonner'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import GitCommitPanel from './GitCommitPanel.vue'

const emit = defineEmits<{ 'open-diff': [] }>()
const { t } = useI18n()
const workspace = useWorkspaceStore()
const worktrees = ref<WorktreeInfo[]>([])
const branch = ref('')
const selectedFolderId = ref<string | null>(null)

function selectedRoot(): string | null {
  return (
    workspace.workspaceFolders.find((folder) => folder.id === selectedFolderId.value)
      ?.resolvedPath ??
    workspace.mainFolder?.resolvedPath ??
    workspace.currentCwd
  )
}

async function refresh() {
  const cwd = selectedRoot()
  if (!cwd) {
    worktrees.value = []
    return
  }
  try {
    worktrees.value = await callApi(() => getApi().worktrees.list(cwd))
  } catch {
    worktrees.value = []
  }
}

async function create() {
  const cwd = selectedRoot()
  if (!cwd || !branch.value.trim()) return
  await callApi(() => getApi().worktrees.create(cwd, branch.value.trim()))
  branch.value = ''
  toast.success(t('workspace.worktreeCreated'))
  await Promise.all([refresh(), workspace.loadGit()])
}

async function remove(path: string) {
  const cwd = selectedRoot()
  if (!cwd) return
  const ok = await askConfirm({
    title: t('workspace.removeWorktreeTitle'),
    description: t('workspace.removeWorktreeConfirm'),
    confirmLabel: t('common.delete'),
    tone: 'danger'
  })
  if (!ok) return
  await callApi(() => getApi().worktrees.remove(cwd, path, false))
  await Promise.all([refresh(), workspace.loadGit()])
}

function selectRepository(folderId: string) {
  selectedFolderId.value = folderId
  workspace.selectGitRepository(folderId)
}

onMounted(() => {
  selectedFolderId.value = workspace.mainFolder?.id ?? null
  void refresh()
  void workspace.loadGit()
})

watch(selectedFolderId, () => {
  if (selectedFolderId.value) workspace.selectGitRepository(selectedFolderId.value)
  void refresh()
})

watch(
  () => workspace.mainFolder?.id,
  (id) => {
    if (!selectedFolderId.value && id) selectedFolderId.value = id
  }
)
</script>

<template>
  <div class="flex flex-col gap-2 px-2 py-2">
    <div
      v-for="repo in workspace.gitStatuses"
      :key="repo.folderId"
      class="rounded-[var(--radius-sm)] border px-2 py-1.5"
      :class="
        selectedFolderId === repo.folderId
          ? 'border-[var(--accent-border)] bg-[var(--accent-tint)]'
          : 'border-[var(--border-subtle)]'
      "
    >
      <button
        type="button"
        class="flex w-full items-center justify-between text-left text-[12px]"
        @click="selectRepository(repo.folderId)"
      >
        <span class="truncate font-medium">{{ repo.folderName }}</span>
        <span class="text-[10.5px] text-[var(--text-tertiary)]">
          {{ repo.isGitRepository ? repo.branch || 'HEAD' : $t('workspace.notGit') }}
        </span>
      </button>
      <p class="text-[10.5px] text-[var(--text-tertiary)]">
        {{ $t('workspace.gitChanges', { count: repo.files.length }) }}
      </p>
    </div>
    <GitCommitPanel v-if="workspace.gitStatus?.isGitRepository" @open-diff="emit('open-diff')" />
    <div class="border-t border-[var(--border-subtle)] pt-2">
      <p class="mb-1 px-1 text-[10.5px] font-medium text-[var(--text-secondary)]">
        {{ $t('workspace.gitWorktrees') }}
      </p>
      <div class="flex gap-1">
        <Input v-model="branch" :placeholder="$t('workspace.branchPlaceholder')" />
        <Button size="sm" @click="create">{{ $t('workspace.addWorktree') }}</Button>
      </div>
      <button
        v-for="wt in worktrees"
        :key="wt.path"
        class="flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] hover:bg-[var(--bg-hover)]"
      >
        <span class="truncate">{{ wt.branch || wt.path }} {{ wt.isMain ? '(main)' : '' }}</span>
        <span
          v-if="!wt.isMain"
          class="text-[11px] text-[var(--danger)]"
          @click.stop="remove(wt.path)"
        >
          {{ $t('common.delete') }}
        </span>
      </button>
    </div>
  </div>
</template>
