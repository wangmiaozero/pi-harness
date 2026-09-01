<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Cloud,
  GitBranch,
  GitPullRequest,
  MoreHorizontal,
  Puzzle,
  Search
} from '@lucide/vue'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import Input from '@renderer/components/ui/Input.vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi, getErrorPayload } from '@renderer/composables/useApi'
import type {
  GitActionRequest,
  GitBranchInfo,
  GitRepositoryOverview,
  WorktreeInfo
} from '@shared/types/workspace'
import { toast } from 'vue-sonner'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import GitCommitPanel from './GitCommitPanel.vue'

const emit = defineEmits<{ 'open-diff': [] }>()
const { t, locale } = useI18n()
const workspace = useWorkspaceStore()
const worktrees = ref<WorktreeInfo[]>([])
const overview = ref<GitRepositoryOverview | null>(null)
const branchFilter = ref('')
const selectedFolderId = ref<string | null>(null)
const loading = ref(false)
const actionBusy = ref(false)
const localOpen = ref(true)
const remoteOpen = ref(true)
const pullRequestsOpen = ref(true)
const submodulesOpen = ref(true)
const worktreesOpen = ref(false)
const promptOpen = ref(false)
const promptMode = ref<'create' | 'rename'>('create')
const promptValue = ref('')
const promptTarget = ref<GitBranchInfo | null>(null)
let refreshVersion = 0

const repository = computed(() => workspace.gitStatus?.repositoryRoot ?? null)
const query = computed(() => branchFilter.value.trim().toLocaleLowerCase())
const localBranches = computed(() => filterBranches('local'))
const remoteBranches = computed(() => filterBranches('remote'))
const upstreamChoices = computed(() =>
  (overview.value?.branches ?? [])
    .filter((branch) => branch.type === 'remote')
    .map((branch) => branch.name)
)

function selectedRoot(): string | null {
  return (
    workspace.workspaceFolders.find((folder) => folder.id === selectedFolderId.value)
      ?.resolvedPath ??
    workspace.mainFolder?.resolvedPath ??
    workspace.currentCwd
  )
}

function filterBranches(type: GitBranchInfo['type']): GitBranchInfo[] {
  return (overview.value?.branches ?? []).filter(
    (branch) =>
      branch.type === type &&
      (!query.value || branch.name.toLocaleLowerCase().includes(query.value))
  )
}

async function refresh() {
  const version = ++refreshVersion
  const cwd = selectedRoot()
  if (!cwd) {
    worktrees.value = []
    overview.value = null
    return
  }
  loading.value = true
  try {
    const [nextWorktrees, nextOverview] = await Promise.all([
      callApi(() => getApi().worktrees.list(cwd)),
      callApi(() => getApi().git.overview(cwd))
    ])
    if (version !== refreshVersion || selectedRoot() !== cwd) return
    worktrees.value = nextWorktrees
    overview.value = nextOverview
  } catch (error) {
    if (version !== refreshVersion || selectedRoot() !== cwd) return
    overview.value = null
    toast.error(getErrorPayload(error).message)
  } finally {
    if (version === refreshVersion) loading.value = false
  }
}

async function runAction(input: Omit<GitActionRequest, 'cwd'>, label: string) {
  const cwd = repository.value
  if (!cwd || actionBusy.value) return
  actionBusy.value = true
  try {
    await callApi(() => getApi().git.action({ cwd, ...input }))
    await workspace.refreshContent()
    await refresh()
    toast.success(t('workspace.gitActionDone', { action: label }))
  } catch (error) {
    toast.error(getErrorPayload(error).message)
  } finally {
    actionBusy.value = false
  }
}

function openCreateBranch(branch: GitBranchInfo | null = null) {
  promptMode.value = 'create'
  promptTarget.value = branch
  promptValue.value = ''
  promptOpen.value = true
}

function openRenameBranch(branch: GitBranchInfo) {
  promptMode.value = 'rename'
  promptTarget.value = branch
  promptValue.value = branch.name
  promptOpen.value = true
}

async function submitPrompt() {
  const value = promptValue.value.trim()
  if (!value) return
  const target = promptTarget.value
  promptOpen.value = false
  if (promptMode.value === 'rename' && target) {
    await runAction(
      { action: 'rename-branch', target: target.name, name: value },
      t('workspace.gitRenameBranch')
    )
    return
  }
  await runAction(
    { action: 'create-branch', name: value, ...(target ? { target: target.name } : {}) },
    t('workspace.gitCreateBranch')
  )
}

async function checkout(branch: GitBranchInfo) {
  if (branch.current) return
  await runAction(
    {
      action: branch.type === 'local' ? 'checkout-branch' : 'checkout-remote',
      target: branch.name
    },
    branch.name
  )
}

async function branchMenu(branch: GitBranchInfo, event?: MouseEvent) {
  event?.preventDefault()
  const selection = await callApi(() =>
    getApi().git.branchContextMenu({
      locale: locale.value === 'zh-CN' ? 'zh-CN' : 'en-US',
      branchName: branch.name,
      branchType: branch.type,
      current: branch.current,
      upstream: branch.upstream,
      upstreamChoices: upstreamChoices.value
    })
  )
  if (!selection) return
  if (selection.action === 'checkout') return checkout(branch)
  if (selection.action === 'copy-name') {
    await navigator.clipboard.writeText(branch.name)
    return
  }
  if (selection.action === 'create-branch') return openCreateBranch(branch)
  if (selection.action === 'rename') return openRenameBranch(branch)
  if (selection.action === 'delete') {
    const ok = await askConfirm({
      title: t('workspace.gitDeleteBranch'),
      description: t('workspace.gitDeleteBranchConfirm', { branch: branch.name }),
      confirmLabel: t('common.delete'),
      tone: 'danger'
    })
    if (ok) {
      await runAction(
        { action: 'delete-branch', target: branch.name },
        t('workspace.gitDeleteBranch')
      )
    }
    return
  }
  if (selection.action === 'merge' || selection.action === 'rebase') {
    const isMerge = selection.action === 'merge'
    const ok = await askConfirm({
      title: t(isMerge ? 'workspace.gitMergeBranch' : 'workspace.gitRebaseBranch'),
      description: t(
        isMerge ? 'workspace.gitMergeBranchConfirm' : 'workspace.gitRebaseBranchConfirm',
        { branch: branch.name }
      ),
      confirmLabel: t(isMerge ? 'workspace.gitMergeBranch' : 'workspace.gitRebaseBranch'),
      tone: 'primary'
    })
    if (ok) await runAction({ action: selection.action, target: branch.name }, branch.name)
    return
  }
  if (selection.action === 'set-upstream' && selection.value) {
    await runAction(
      { action: 'set-upstream', target: branch.name, upstream: selection.value },
      selection.value
    )
    return
  }
  if (selection.action === 'unset-upstream') {
    await runAction({ action: 'unset-upstream', target: branch.name }, branch.name)
    return
  }
  if (selection.action === 'push') {
    await runAction({ action: 'push', target: branch.name }, t('workspace.gitPush'))
  }
}

async function removeWorktree(path: string) {
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
  void workspace.loadGit()
})

watch(selectedFolderId, () => {
  if (selectedFolderId.value) workspace.selectGitRepository(selectedFolderId.value)
  void refresh()
})

watch([repository, () => workspace.gitRevision], () => void refresh())
</script>

<template>
  <div class="flex flex-col gap-2 px-2 py-2" data-testid="git-repository-sidebar">
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

    <GitCommitPanel
      v-if="workspace.gitStatus?.isGitRepository"
      @open-diff="emit('open-diff')"
    />

    <div v-if="overview" class="space-y-1 border-t border-[var(--border-subtle)] pt-2">
      <div class="relative">
        <Search
          class="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[var(--text-tertiary)]"
        />
        <Input v-model="branchFilter" class="pl-7" :placeholder="$t('workspace.gitBranchFilter')" />
      </div>
      <p class="px-1 text-[9.5px] text-[var(--text-disabled)]">
        {{ $t('workspace.gitContextHint') }}
      </p>

      <section>
        <button class="git-section-title" type="button" @click="localOpen = !localOpen">
          <ChevronDown v-if="localOpen" class="size-3" />
          <ChevronRight v-else class="size-3" />
          <GitBranch class="size-3" />{{ $t('workspace.gitLocalBranches') }}
          <span class="ml-auto">{{ localBranches.length }}</span>
        </button>
        <div v-if="localOpen">
          <button
            v-for="branch in localBranches"
            :key="branch.fullName"
            type="button"
            class="git-tree-row group"
            :class="branch.current ? 'bg-[var(--accent-tint)] text-[var(--accent)]' : ''"
            :data-git-branch="branch.name"
            @dblclick="checkout(branch)"
            @contextmenu="branchMenu(branch, $event)"
          >
            <CircleDot class="size-2.5 shrink-0" :class="branch.current ? 'fill-current' : ''" />
            <span class="min-w-0 flex-1 truncate text-left">{{ branch.name }}</span>
            <span
              v-if="branch.ahead || branch.behind"
              class="text-[9px] text-[var(--text-tertiary)]"
            >
              {{ $t('workspace.gitAheadBehind', { ahead: branch.ahead, behind: branch.behind }) }}
            </span>
            <IconButton
              :label="branch.name"
              class="opacity-0 group-hover:opacity-100"
              @click.stop="branchMenu(branch)"
            >
              <MoreHorizontal class="size-3" />
            </IconButton>
          </button>
        </div>
      </section>

      <section>
        <button class="git-section-title" type="button" @click="remoteOpen = !remoteOpen">
          <ChevronDown v-if="remoteOpen" class="size-3" />
          <ChevronRight v-else class="size-3" />
          <Cloud class="size-3" />{{ $t('workspace.gitRemoteBranches') }}
          <span class="ml-auto">{{ overview.remotes.length }}</span>
        </button>
        <div v-if="remoteOpen">
          <p v-if="!remoteBranches.length" class="git-empty-row">
            {{ $t('workspace.gitNoRemotes') }}
          </p>
          <button
            v-for="branch in remoteBranches"
            :key="branch.fullName"
            type="button"
            class="git-tree-row group"
            :data-git-branch="branch.name"
            @dblclick="checkout(branch)"
            @contextmenu="branchMenu(branch, $event)"
          >
            <GitBranch class="size-2.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate text-left">{{ branch.name }}</span>
            <IconButton
              :label="branch.name"
              class="opacity-0 group-hover:opacity-100"
              @click.stop="branchMenu(branch)"
            >
              <MoreHorizontal class="size-3" />
            </IconButton>
          </button>
        </div>
      </section>

      <section>
        <button
          class="git-section-title"
          type="button"
          @click="pullRequestsOpen = !pullRequestsOpen"
        >
          <ChevronDown v-if="pullRequestsOpen" class="size-3" />
          <ChevronRight v-else class="size-3" />
          <GitPullRequest class="size-3" />{{ $t('workspace.gitPullRequests') }}
          <span class="ml-auto">
            {{ overview.pullRequests.authenticated ? overview.pullRequests.items.length : '—' }}
          </span>
        </button>
        <div v-if="pullRequestsOpen">
          <p v-if="overview.pullRequests.message" class="git-empty-row leading-snug">
            {{ overview.pullRequests.message }}
          </p>
          <a
            v-for="pr in overview.pullRequests.items"
            :key="pr.number"
            :href="pr.url"
            target="_blank"
            rel="noreferrer"
            class="git-tree-row"
          >
            <span class="shrink-0 text-[9.5px] text-[var(--accent)]">#{{ pr.number }}</span>
            <span class="min-w-0 flex-1 truncate">{{ pr.title }}</span>
            <span v-if="pr.draft" class="text-[8.5px] text-[var(--text-tertiary)]">
              {{ $t('workspace.gitDraft') }}
            </span>
          </a>
        </div>
      </section>

      <section>
        <button
          class="git-section-title"
          type="button"
          @click="submodulesOpen = !submodulesOpen"
        >
          <ChevronDown v-if="submodulesOpen" class="size-3" />
          <ChevronRight v-else class="size-3" />
          <Puzzle class="size-3" />{{ $t('workspace.gitSubmodules') }}
          <span class="ml-auto">{{ overview.submodules.length }}</span>
        </button>
        <div v-if="submodulesOpen">
          <p v-if="!overview.submodules.length" class="git-empty-row">
            {{ $t('workspace.gitNoSubmodules') }}
          </p>
          <div
            v-for="submodule in overview.submodules"
            :key="submodule.path"
            class="git-tree-row"
          >
            <Puzzle class="size-2.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{{ submodule.path }}</span>
            <span class="text-[8.5px] text-[var(--text-tertiary)]">{{ submodule.state }}</span>
          </div>
        </div>
      </section>

      <section>
        <button
          class="git-section-title"
          type="button"
          @click="worktreesOpen = !worktreesOpen"
        >
          <ChevronDown v-if="worktreesOpen" class="size-3" />
          <ChevronRight v-else class="size-3" />
          <GitBranch class="size-3" />{{ $t('workspace.gitWorktrees') }}
          <span class="ml-auto">{{ worktrees.length }}</span>
        </button>
        <div v-if="worktreesOpen">
          <div v-for="worktree in worktrees" :key="worktree.path" class="git-tree-row">
            <span class="min-w-0 flex-1 truncate">
              {{ worktree.branch || worktree.path }} {{ worktree.isMain ? '(main)' : '' }}
            </span>
            <button
              v-if="!worktree.isMain"
              class="text-[9.5px] text-[var(--danger)]"
              @click="removeWorktree(worktree.path)"
            >
              {{ $t('common.delete') }}
            </button>
          </div>
        </div>
      </section>

      <div
        class="flex items-center justify-between px-1 pt-1 text-[9.5px] text-[var(--text-tertiary)]"
      >
        <span>{{ $t('workspace.gitStashCount', { count: overview.stashCount }) }}</span>
        <Button
          size="sm"
          variant="ghost"
          data-testid="git-create-branch-sidebar"
          @click="openCreateBranch()"
        >
          {{ $t('workspace.gitCreateBranch') }}
        </Button>
      </div>
    </div>
    <p
      v-else-if="loading"
      class="px-2 py-4 text-center text-[10px] text-[var(--text-tertiary)]"
    >
      {{ $t('common.loading') }}
    </p>

    <Dialog
      v-model:open="promptOpen"
      :title="
        promptMode === 'rename'
          ? $t('workspace.gitRenameBranch')
          : $t('workspace.gitCreateBranch')
      "
      :description="
        promptMode === 'create' && promptTarget
          ? $t('workspace.gitCreateBranchFrom', { ref: promptTarget.name })
          : undefined
      "
    >
      <form class="space-y-3" @submit.prevent="submitPrompt">
        <Input v-model="promptValue" autofocus :placeholder="$t('workspace.gitBranchName')" />
      </form>
      <template #footer>
        <Button variant="ghost" @click="promptOpen = false">{{ $t('common.cancel') }}</Button>
        <Button variant="primary" :disabled="!promptValue.trim()" @click="submitPrompt">
          {{ $t('common.confirm') }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.git-section-title {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.25rem;
  color: var(--text-tertiary);
  font-size: 10.5px;
  font-weight: 600;
}

.git-tree-row {
  display: flex;
  min-height: 28px;
  width: 100%;
  align-items: center;
  gap: 0.35rem;
  border-radius: var(--radius-sm);
  padding: 0 0.35rem 0 0.75rem;
  color: var(--text-secondary);
  font-size: 10.5px;
}

.git-tree-row:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.git-empty-row {
  padding: 0.3rem 0.75rem;
  color: var(--text-disabled);
  font-size: 9.5px;
}
</style>
