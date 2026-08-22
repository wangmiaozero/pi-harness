<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'
import type { WorktreeInfo } from '@shared/types/workspace'
import { toast } from 'vue-sonner'
import { askConfirm } from '@renderer/composables/useConfirmDialog'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const worktrees = ref<WorktreeInfo[]>([])
const branch = ref('')

async function refresh() {
  const cwd = workspace.currentCwd
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
  const cwd = workspace.currentCwd
  if (!cwd || !branch.value.trim()) return
  await callApi(() => getApi().worktrees.create(cwd, branch.value.trim()))
  branch.value = ''
  toast.success(t('workspace.worktreeCreated'))
  await refresh()
}

async function remove(path: string) {
  const cwd = workspace.currentCwd
  if (!cwd) return
  const ok = await askConfirm({
    title: t('workspace.removeWorktreeTitle'),
    description: t('workspace.removeWorktreeConfirm'),
    confirmLabel: t('common.delete'),
    tone: 'danger'
  })
  if (!ok) return
  await callApi(() => getApi().worktrees.remove(cwd, path, false))
  await refresh()
}

function openDiff(filePath: string) {
  const name = filePath.split(/[\\/]/).pop() ?? filePath
  workspace.openDiffTab(filePath, `Diff: ${name}`)
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="flex flex-col gap-2 px-2 py-2">
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
      <span v-if="!wt.isMain" class="text-[11px] text-[var(--danger)]" @click.stop="remove(wt.path)">
        {{ $t('common.delete') }}
      </span>
    </button>
    <div v-if="workspace.gitStatus?.files?.length" class="mt-2">
      <p class="mb-1 text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
        {{ $t('workspace.changes') }}
      </p>
      <button
        v-for="file in workspace.gitStatus.files"
        :key="file.filePath"
        class="flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2 py-1 text-[12px] hover:bg-[var(--bg-hover)]"
        @click="openDiff(file.filePath)"
      >
        <span class="truncate">{{ file.filePath.split(/[\\/]/).pop() }}</span>
        <span class="text-[10px] text-[var(--text-tertiary)]">{{ file.code }}</span>
      </button>
    </div>
  </div>
</template>
