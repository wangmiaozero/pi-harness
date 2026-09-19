<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Cloud,
  GitBranch,
  GitPullRequest,
  MoreHorizontal,
  Plus,
  Puzzle,
  Search,
  Tag,
  X
} from '@lucide/vue'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import Input from '@renderer/components/ui/Input.vue'
import ContextMenu from '@renderer/components/ui/ContextMenu.vue'
import GitActivityGraph from './GitActivityGraph.vue'
import GitActivityDetails from './GitActivityDetails.vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useSettingsStore } from '@renderer/stores/settings'
import { callApi, getApi, getErrorMessage } from '@renderer/composables/useApi'
import type {
  GitActionRequest,
  GitBranchContextAction,
  GitBranchInfo,
  GitContextMenuSelection,
  GitRepositoryOverview,
  GitStashInfo,
  GitTagInfo,
  WorktreeInfo
} from '@shared/types/workspace'
import { toast } from 'vue-sonner'
import { toNativeMenuLocale } from '@shared/constants/language'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { getActiveVisualSkin } from '@renderer/utils/visual-skin'

type ContextMenuEntry =
  | {
      type: 'action'
      id: string
      label: string
      disabled?: boolean
      danger?: boolean
      checked?: boolean
      inset?: boolean
      value?: string
      testId?: string
    }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: string }

const emit = defineEmits<{
  'select-ref': [selection: { name: string; hash: string }]
  'locate-commit': [hash: string]
}>()
const { t, locale } = useI18n()
const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const worktrees = ref<WorktreeInfo[]>([])
const overview = ref<GitRepositoryOverview | null>(null)
const branchFilter = ref('')
const selectedFolderId = ref<string | null>(null)
const loading = ref(false)
const actionBusy = ref(false)
const localOpen = ref(true)
const remoteOpen = ref(true)
const pullRequestsOpen = ref(true)
const tagsOpen = ref(true)
const stashesOpen = ref(true)
const submodulesOpen = ref(true)
const worktreesOpen = ref(false)
const activityOpen = ref(false)
const promptOpen = ref(false)
const promptMode = ref<'create' | 'rename' | 'create-tag'>('create')
const promptValue = ref('')
const promptTarget = ref<GitBranchInfo | null>(null)
const branchContextMenu = ref<{ branch: GitBranchInfo; x: number; y: number } | null>(null)
const tagContextMenu = ref<{ tag: GitTagInfo; x: number; y: number } | null>(null)
const stashContextMenu = ref<{ stash: GitStashInfo; x: number; y: number } | null>(null)
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
const filtering = computed(() => query.value.length > 0)
const headBranch = computed(
  () => (overview.value?.branches ?? []).find((branch) => branch.current) ?? null
)
const tags = computed(() =>
  (overview.value?.tags ?? []).filter(
    (tag) => !query.value || tag.name.toLocaleLowerCase().includes(query.value)
  )
)
const stashes = computed(() =>
  (overview.value?.stashes ?? []).filter(
    (stash) =>
      !query.value || `${stash.ref} ${stash.message}`.toLocaleLowerCase().includes(query.value)
  )
)
const activity = computed(() => overview.value?.activity ?? [])
const mingDynastyActive = computed(() => {
  const skin = getActiveVisualSkin(settings.settings)?.id
  return skin === 'ming-snow' || skin === 'ming-moon'
})
const branchMenuEntries = computed(() => {
  const branch = branchContextMenu.value?.branch
  if (!branch) return []
  const zh = toNativeMenuLocale(locale.value) === 'zh-CN'
  const entries: Array<
    | {
        type: 'action'
        id: string
        label: string
        disabled?: boolean
        danger?: boolean
        checked?: boolean
        inset?: boolean
        value?: string
      }
    | { type: 'separator'; id: string }
    | { type: 'label'; id: string; label: string }
  > = [
    {
      type: 'action',
      id: 'checkout',
      label: zh ? `检出 ${branch.name}` : `Checkout ${branch.name}`,
      disabled: branch.current
    }
  ]
  if (branch.type === 'local') {
    entries.push({ type: 'action', id: 'push', label: zh ? '推送' : 'Push' })
  }
  entries.push(
    { type: 'separator', id: 'integrate' },
    {
      type: 'action',
      id: 'merge',
      label: zh ? '合并到当前分支' : 'Merge into current branch',
      disabled: branch.current
    },
    {
      type: 'action',
      id: 'rebase',
      label: zh ? '将当前分支 Rebase 到此分支' : 'Rebase current branch onto this branch',
      disabled: branch.current
    },
    { type: 'separator', id: 'manage' },
    {
      type: 'action',
      id: 'create-branch',
      label: zh ? '从此处创建分支…' : 'Create branch here…'
    }
  )
  if (branch.type === 'local') {
    entries.push({ type: 'action', id: 'rename', label: zh ? '重命名…' : 'Rename…' })
    if (upstreamChoices.value.length) {
      entries.push({ type: 'label', id: 'upstream-label', label: zh ? '设置上游分支' : 'Set upstream' })
      upstreamChoices.value.forEach((choice) => {
        entries.push({
          type: 'action',
          id: 'set-upstream',
          value: choice,
          label: choice,
          checked: choice === branch.upstream,
          inset: true
        })
      })
    } else {
      entries.push({
        type: 'action',
        id: 'set-upstream',
        label: zh ? '设置上游分支' : 'Set upstream',
        disabled: true
      })
    }
    if (branch.upstream) {
      entries.push({
        type: 'action',
        id: 'unset-upstream',
        label: zh ? '取消上游分支' : 'Unset upstream'
      })
    }
    entries.push(
      { type: 'separator', id: 'delete-separator' },
      {
        type: 'action',
        id: 'delete',
        label: zh ? '删除分支…' : 'Delete branch…',
        disabled: branch.current,
        danger: true
      }
    )
  }
  entries.push(
    { type: 'separator', id: 'copy-separator' },
    {
      type: 'action',
      id: 'copy-name',
      label: zh ? '复制分支名称' : 'Copy branch name'
    }
  )
  return entries
})

function selectedRoot(): string | null {
  // Git is workspace-wide: resolve the selection among all navigation projects.
  return (
    workspace.gitRoots.find((root) => root.id === selectedFolderId.value)?.path ??
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
    toast.error(getErrorMessage(error))
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
    toast.error(getErrorMessage(error))
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

function openCreateTag() {
  promptMode.value = 'create-tag'
  promptTarget.value = null
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
  if (promptMode.value === 'create-tag') {
    await runAction({ action: 'create-tag', name: value }, t('workspace.gitCreateTag'))
    return
  }
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

function selectRef(branch: GitBranchInfo) {
  emit('select-ref', { name: branch.name, hash: branch.tipHash })
}

function locateHead() {
  const hash = headBranch.value?.tipHash
  if (hash) emit('locate-commit', hash)
}

async function runHeadAction() {
  await runAction({ action: 'stash' }, t('workspace.gitStash'))
}

const filteredWorktrees = computed(() => {
  const repositoryRoot = workspace.gitStatus?.repositoryRoot ?? null
  return worktrees.value.filter(
    (worktree) =>
      !(worktree.isMain && (!repositoryRoot || worktree.path === repositoryRoot)) &&
      (!query.value ||
        `${worktree.branch ?? ''} ${worktree.path}`
          .toLocaleLowerCase()
          .includes(query.value))
  )
})

const hasMatches = computed(
  () =>
    localBranches.value.length > 0 ||
    remoteBranches.value.length > 0 ||
    tags.value.length > 0 ||
    stashes.value.length > 0 ||
    filteredWorktrees.value.length > 0
)

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
  event?.stopPropagation()
  if (mingDynastyActive.value) {
    const target = event?.currentTarget as HTMLElement | null
    const rect = target?.getBoundingClientRect()
    branchContextMenu.value = {
      branch,
      x: event?.clientX || rect?.left || 8,
      y: event?.clientY || rect?.bottom || 8
    }
    return
  }
  const selection = await callApi(() =>
    getApi().git.branchContextMenu({
      locale: toNativeMenuLocale(locale.value),
      branchName: branch.name,
      branchType: branch.type,
      current: branch.current,
      upstream: branch.upstream,
      upstreamChoices: upstreamChoices.value
    })
  )
  if (selection) await runBranchMenuSelection(branch, selection)
}

async function runBranchMenuSelection(
  branch: GitBranchInfo,
  selection: GitContextMenuSelection<GitBranchContextAction>
) {
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

async function runCustomBranchMenuAction(action: string, value?: string) {
  const branch = branchContextMenu.value?.branch
  if (!branch) return
  await runBranchMenuSelection(branch, {
    action: action as GitBranchContextAction,
    ...(value ? { value } : {})
  })
}

// --- Tags & stashes --------------------------------------------------------

const tagMenuEntries = computed<ContextMenuEntry[]>(() => {
  const zh = toNativeMenuLocale(locale.value) === 'zh-CN'
  return [
    { type: 'action', id: 'checkout', label: zh ? '检出（分离 HEAD）' : 'Checkout (detached)' },
    { type: 'separator', id: 'tag-sep-1' },
    { type: 'action', id: 'push-tag', label: zh ? '推送标签' : 'Push tag' },
    { type: 'action', id: 'copy-name', label: zh ? '复制标签名称' : 'Copy tag name' },
    { type: 'separator', id: 'tag-sep-2' },
    { type: 'action', id: 'delete', label: zh ? '删除标签…' : 'Delete tag…', danger: true }
  ]
})

async function runTagMenuAction(action: string) {
  const tag = tagContextMenu.value?.tag
  if (!tag) return
  if (action === 'checkout') {
    await runAction({ action: 'checkout-tag', target: tag.name }, tag.name)
    return
  }
  if (action === 'push-tag') {
    await runAction({ action: 'push-tag', target: tag.name }, tag.name)
    return
  }
  if (action === 'copy-name') {
    await navigator.clipboard.writeText(tag.name)
    return
  }
  if (action === 'delete') {
    const ok = await askConfirm({
      title: t('workspace.gitDeleteTag'),
      description: t('workspace.gitDeleteTagConfirm', { tag: tag.name }),
      confirmLabel: t('common.delete'),
      tone: 'danger'
    })
    if (ok) await runAction({ action: 'delete-tag', target: tag.name }, tag.name)
  }
}

const stashMenuEntries = computed<ContextMenuEntry[]>(() => {
  const zh = toNativeMenuLocale(locale.value) === 'zh-CN'
  return [
    { type: 'action', id: 'apply', label: zh ? '应用（保留贮藏）' : 'Apply (keep stash)' },
    { type: 'action', id: 'pop', label: zh ? '弹出（应用并删除）' : 'Pop (apply and remove)' },
    { type: 'separator', id: 'stash-sep-1' },
    { type: 'action', id: 'drop', label: zh ? '删除…' : 'Drop…', danger: true }
  ]
})

async function runStashMenuAction(action: string) {
  const stash = stashContextMenu.value?.stash
  if (!stash) return
  if (action === 'apply') {
    await runAction({ action: 'stash-apply', target: stash.ref }, stash.ref)
    return
  }
  if (action === 'pop') {
    await runAction({ action: 'stash-pop', target: stash.ref }, stash.ref)
    return
  }
  if (action === 'drop') {
    const ok = await askConfirm({
      title: t('workspace.gitDropStashTitle'),
      description: t('workspace.gitDropStashConfirm', {
        stash: stash.message || stash.ref
      }),
      confirmLabel: t('common.delete'),
      tone: 'danger'
    })
    if (ok) await runAction({ action: 'stash-drop', target: stash.ref }, stash.ref)
  }
}

function stashLabel(stash: GitStashInfo): string {
  const seconds = Math.max(1, Math.round((Date.now() - stash.timestamp * 1000) / 1000))
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ]
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
  for (const [unit, secondsInUnit] of units) {
    if (seconds >= secondsInUnit) {
      return formatter.format(-Math.floor(seconds / secondsInUnit), unit)
    }
  }
  return formatter.format(0, 'day')
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
  selectedFolderId.value =
    workspace.selectedGitFolderId ??
    workspace.gitStatuses[0]?.folderId ??
    workspace.mainFolder?.id ??
    null
  void workspace.loadGit()
  void refresh()
})

// Keep the local selection aligned with the workspace-wide repository list.
watch(
  () => workspace.gitStatuses,
  (statuses) => {
    if (!statuses.length) return
    if (!statuses.some((repo) => repo.folderId === selectedFolderId.value)) {
      selectedFolderId.value = workspace.selectedGitFolderId ?? statuses[0]?.folderId ?? null
    }
  },
  { immediate: true }
)

watch(selectedFolderId, () => {
  if (selectedFolderId.value) workspace.selectGitRepository(selectedFolderId.value)
  void refresh()
})

watch([repository, () => workspace.gitRevision], () => void refresh())
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="git-repository-sidebar">
    <!-- Repository switcher: a workspace can hold several projects. -->
    <div class="shrink-0 border-b border-[var(--border-subtle)] p-2">
      <div class="max-h-[148px] overflow-y-auto" data-testid="git-project-list">
        <button
          v-for="repo in workspace.gitStatuses"
          :key="repo.folderId"
          type="button"
          class="mb-1 flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1 text-left last:mb-0"
          :class="
            selectedFolderId === repo.folderId
              ? 'bg-[var(--accent-tint)] text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          "
          :title="repo.folderName"
          @click="selectRepository(repo.folderId)"
        >
          <span class="min-w-0 flex-1 truncate text-[10.5px] font-medium">{{ repo.folderName }}</span>
          <span class="shrink-0 text-[9px] opacity-70">
            {{ repo.isGitRepository ? repo.branch || 'HEAD' : $t('workspace.notGit') }}
          </span>
        </button>
      </div>
    </div>

    <!-- HEAD chip: the branch you are standing on, above everything foldable. -->
    <button
      v-if="repository"
      type="button"
      class="mx-2 mt-2 flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 text-left"
      :class="
        headBranch
          ? 'border-[var(--accent-border)] bg-[var(--accent-tint)]'
          : 'border-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]'
      "
      :title="$t('workspace.gitHeadChipHint')"
      @click="locateHead"
    >
      <CircleDot
        class="size-3 shrink-0"
        :class="headBranch ? 'text-[var(--accent)]' : 'text-[var(--warning)]'"
        :stroke-width="1.75"
      />
      <span
        class="min-w-0 flex-1 truncate text-[11px] font-semibold"
        :class="headBranch ? 'text-[var(--accent)]' : 'text-[var(--warning)]'"
      >
        {{ headBranch ? headBranch.name : $t('workspace.gitDetachedHead') }}
      </span>
      <span
        v-if="headBranch && (headBranch.ahead > 0 || headBranch.behind > 0)"
        class="shrink-0 font-[family-name:var(--font-mono)] text-[9.5px] font-semibold"
      >
        <span v-if="headBranch.ahead > 0" class="text-[var(--success)]">↑{{ headBranch.ahead }}</span>
        <span v-if="headBranch.behind > 0" class="text-[var(--warning)]">↓{{ headBranch.behind }}</span>
      </span>
    </button>

    <!-- Filter: pinned above the scroller, applies to every section. -->
    <div class="relative mx-2 mb-1 mt-2 shrink-0">
      <Search
        class="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[var(--text-tertiary)]"
      />
      <input
        v-model="branchFilter"
        type="search"
        class="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] pl-7 pr-6 text-[10.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-border)]"
        :placeholder="$t('workspace.gitSidebarFilter')"
        data-testid="git-sidebar-filter"
      />
      <button
        v-if="branchFilter"
        type="button"
        class="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        :aria-label="$t('common.close')"
        @click="branchFilter = ''"
      >
        <X class="size-3" />
      </button>
    </div>

    <!-- Sections -->
    <div class="min-h-0 flex-1 overflow-y-auto pb-2">
      <template v-if="overview">
        <section class="px-2">
          <button
            class="git-section-title"
            type="button"
            data-testid="git-section-local"
            @click="localOpen = !localOpen"
          >
            <ChevronDown v-if="localOpen || filtering" class="size-3" />
            <ChevronRight v-else class="size-3" />
            <GitBranch class="size-3" />{{ $t('workspace.gitLocalBranches') }}
            <span class="ml-auto">{{ localBranches.length }}</span>
            <IconButton
              :label="$t('workspace.gitCreateBranch')"
              data-testid="git-create-branch-sidebar"
              class="ml-1"
              @click.stop="openCreateBranch()"
            >
              <Plus class="size-3" />
            </IconButton>
          </button>
          <div v-if="localOpen || filtering">
            <button
              v-for="branch in localBranches"
              :key="branch.fullName"
              type="button"
              class="git-tree-row group"
              :class="branch.current ? 'bg-[var(--accent-tint)] text-[var(--accent)]' : ''"
              :data-git-branch="branch.name"
              :title="branch.name"
              @click="selectRef(branch)"
              @dblclick="checkout(branch)"
              @contextmenu="branchMenu(branch, $event)"
            >
              <CircleDot
                class="size-2.5 shrink-0"
                :class="branch.current ? 'fill-current' : ''"
              />
              <span class="min-w-0 flex-1 truncate text-left">{{ branch.name }}</span>
              <span
                v-if="branch.ahead || branch.behind"
                class="font-[family-name:var(--font-mono)] text-[9px] text-[var(--text-tertiary)]"
              >
                {{ $t('workspace.gitAheadBehind', { ahead: branch.ahead, behind: branch.behind }) }}
              </span>
              <IconButton
                :label="branch.name"
                class="opacity-0 group-hover:opacity-100"
                @click.stop="branchMenu(branch, $event)"
              >
                <MoreHorizontal class="size-3" />
              </IconButton>
            </button>
          </div>
        </section>

        <section class="px-2">
          <button
            class="git-section-title"
            type="button"
            data-testid="git-section-remote"
            @click="remoteOpen = !remoteOpen"
          >
            <ChevronDown v-if="remoteOpen || filtering" class="size-3" />
            <ChevronRight v-else class="size-3" />
            <Cloud class="size-3" />{{ $t('workspace.gitRemoteBranches') }}
            <span class="ml-auto">
              {{ filtering ? remoteBranches.length : overview.remotes.length }}
            </span>
          </button>
          <div v-if="remoteOpen || filtering">
            <p v-if="!remoteBranches.length" class="git-empty-row">
              {{ $t('workspace.gitNoRemotes') }}
            </p>
            <button
              v-for="branch in remoteBranches"
              :key="branch.fullName"
              type="button"
              class="git-tree-row group"
              :data-git-branch="branch.name"
              :title="branch.name"
              @click="selectRef(branch)"
              @dblclick="checkout(branch)"
              @contextmenu="branchMenu(branch, $event)"
            >
              <GitBranch class="size-2.5 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-left">{{ branch.name }}</span>
              <IconButton
                :label="branch.name"
                class="opacity-0 group-hover:opacity-100"
                @click.stop="branchMenu(branch, $event)"
              >
                <MoreHorizontal class="size-3" />
              </IconButton>
            </button>
          </div>
        </section>

        <section class="px-2">
          <button
            class="git-section-title"
            type="button"
            data-testid="git-section-pull-requests"
            @click="pullRequestsOpen = !pullRequestsOpen"
          >
            <ChevronDown v-if="pullRequestsOpen || filtering" class="size-3" />
            <ChevronRight v-else class="size-3" />
            <GitPullRequest class="size-3" />{{ $t('workspace.gitPullRequests') }}
            <span class="ml-auto">
              {{ overview.pullRequests.authenticated ? overview.pullRequests.items.length : '—' }}
            </span>
          </button>
          <div v-if="pullRequestsOpen || filtering">
            <p
              v-if="overview.pullRequests.message && !filtering"
              class="git-empty-row leading-snug"
            >
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

        <section v-if="overview.tags.length" class="px-2">
          <button
            class="git-section-title"
            type="button"
            data-testid="git-section-tags"
            @click="tagsOpen = !tagsOpen"
          >
            <ChevronDown v-if="tagsOpen || filtering" class="size-3" />
            <ChevronRight v-else class="size-3" />
            <Tag class="size-3" />{{ $t('workspace.gitTags') }}
            <span class="ml-auto">{{ tags.length }}</span>
            <IconButton
              :label="$t('workspace.gitCreateTag')"
              class="ml-1"
              @click.stop="openCreateTag"
            >
              <Plus class="size-3" />
            </IconButton>
          </button>
          <div v-if="tagsOpen || filtering">
            <p v-if="!tags.length" class="git-empty-row">{{ $t('workspace.gitNoTags') }}</p>
            <button
              v-for="tag in tags"
              :key="tag.name"
              type="button"
              class="git-tree-row"
              :title="`${tag.name} · ${tag.hash.slice(0, 7)}`"
              @click="emit('locate-commit', tag.hash)"
              @contextmenu.prevent="tagContextMenu = { tag, x: $event.clientX, y: $event.clientY }"
            >
              <Tag class="size-2.5 shrink-0 text-[var(--text-tertiary)]" />
              <span class="min-w-0 flex-1 truncate text-left">{{ tag.name }}</span>
              <span
                class="shrink-0 font-[family-name:var(--font-mono)] text-[9px] text-[var(--text-tertiary)]"
              >
                {{ tag.hash.slice(0, 7) }}
              </span>
            </button>
          </div>
        </section>

        <section v-if="overview.stashes.length" class="px-2">
          <button
            class="git-section-title"
            type="button"
            data-testid="git-section-stashes"
            @click="stashesOpen = !stashesOpen"
          >
            <ChevronDown v-if="stashesOpen || filtering" class="size-3" />
            <ChevronRight v-else class="size-3" />
            <Archive class="size-3" />{{ $t('workspace.gitStashes') }}
            <span class="ml-auto">{{ stashes.length }}</span>
            <IconButton
              :label="$t('workspace.gitStash')"
              class="ml-1"
              :disabled="actionBusy"
              @click.stop="runHeadAction"
            >
              <Plus class="size-3" />
            </IconButton>
          </button>
          <div v-if="stashesOpen || filtering">
            <p v-if="!stashes.length" class="git-empty-row">{{ $t('workspace.gitNoStashes') }}</p>
            <button
              v-for="stash in stashes"
              :key="stash.ref"
              type="button"
              class="git-tree-row"
              :title="stash.message"
              @click="stash.baseHash && emit('locate-commit', stash.baseHash)"
              @contextmenu.prevent="
                stashContextMenu = { stash, x: $event.clientX, y: $event.clientY }
              "
            >
              <Archive class="size-2.5 shrink-0 text-[var(--text-tertiary)]" />
              <span class="min-w-0 flex-1 truncate text-left">
                {{ stash.message || stash.ref }}
              </span>
              <span class="shrink-0 text-[9px] text-[var(--text-tertiary)]">
                {{ stashLabel(stash) }}
              </span>
            </button>
          </div>
        </section>

        <section class="px-2">
          <button
            class="git-section-title"
            type="button"
            data-testid="git-section-submodules"
            @click="submodulesOpen = !submodulesOpen"
          >
            <ChevronDown v-if="submodulesOpen || filtering" class="size-3" />
            <ChevronRight v-else class="size-3" />
            <Puzzle class="size-3" />{{ $t('workspace.gitSubmodules') }}
            <span class="ml-auto">{{ overview.submodules.length }}</span>
          </button>
          <div v-if="submodulesOpen || filtering">
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

        <section v-if="filteredWorktrees.length" class="px-2">
          <button
            class="git-section-title"
            type="button"
            data-testid="git-section-worktrees"
            @click="worktreesOpen = !worktreesOpen"
          >
            <ChevronDown v-if="worktreesOpen || filtering" class="size-3" />
            <ChevronRight v-else class="size-3" />
            <GitBranch class="size-3" />{{ $t('workspace.gitWorktrees') }}
            <span class="ml-auto">{{ filteredWorktrees.length }}</span>
          </button>
          <div v-if="worktreesOpen || filtering">
            <div v-for="worktree in filteredWorktrees" :key="worktree.path" class="git-tree-row">
              <span class="min-w-0 flex-1 truncate">
                {{ worktree.branch || worktree.path }}{{ worktree.isMain ? ' · main' : '' }}
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

        <p v-if="filtering && !hasMatches" class="px-3 pt-2 text-[9px] text-[var(--text-disabled)]">
          {{ $t('workspace.gitNoMatches', { query: branchFilter.trim() }) }}
        </p>
      </template>
      <p
        v-else-if="loading"
        class="px-2 py-4 text-center text-[10px] text-[var(--text-tertiary)]"
      >
        {{ $t('common.loading') }}
      </p>
    </div>

    <!-- Activity: pinned at the bottom, out of the scroller. -->
    <div
      v-if="activity.length"
      class="shrink-0 overflow-x-auto border-t border-[var(--border-subtle)] px-2 py-2"
    >
      <button
        type="button"
        data-testid="git-activity-open"
        class="w-full rounded-[var(--radius-sm)] text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        :aria-label="$t('workspace.gitActivityOpenDetails')"
        @click="activityOpen = true"
      >
        <GitActivityGraph :days="activity" />
      </button>
    </div>

    <Dialog
      v-model:open="activityOpen"
      large
      :title="$t('workspace.gitActivityDetails')"
      :description="$t('workspace.gitActivityLabel')"
    >
      <GitActivityDetails v-if="activityOpen" :days="activity" />
    </Dialog>

    <Dialog
      v-model:open="promptOpen"
      :title="
        promptMode === 'rename'
          ? $t('workspace.gitRenameBranch')
          : promptMode === 'create-tag'
            ? $t('workspace.gitCreateTag')
            : $t('workspace.gitCreateBranch')
      "
      :description="
        promptMode === 'create' && promptTarget
          ? $t('workspace.gitCreateBranchFrom', { ref: promptTarget.name })
          : undefined
      "
    >
      <form class="space-y-3" @submit.prevent="submitPrompt">
        <Input
          v-model="promptValue"
          autofocus
          :placeholder="promptMode === 'create-tag' ? $t('workspace.gitTagName') : $t('workspace.gitBranchName')"
        />
      </form>
      <template #footer>
        <Button variant="ghost" @click="promptOpen = false">{{ $t('common.cancel') }}</Button>
        <Button variant="primary" :disabled="!promptValue.trim()" @click="submitPrompt">
          {{ $t('common.confirm') }}
        </Button>
      </template>
    </Dialog>

    <ContextMenu
      :open="Boolean(branchContextMenu)"
      :x="branchContextMenu?.x ?? 0"
      :y="branchContextMenu?.y ?? 0"
      :label="branchContextMenu?.branch.name ?? ''"
      :entries="branchMenuEntries"
      :width="284"
      test-id="git-branch-context-menu"
      @close="branchContextMenu = null"
      @select="runCustomBranchMenuAction"
    />
    <ContextMenu
      :open="Boolean(tagContextMenu)"
      :x="tagContextMenu?.x ?? 0"
      :y="tagContextMenu?.y ?? 0"
      :label="tagContextMenu?.tag.name ?? ''"
      :entries="tagMenuEntries"
      test-id="git-tag-context-menu"
      @close="tagContextMenu = null"
      @select="runTagMenuAction"
    />
    <ContextMenu
      :open="Boolean(stashContextMenu)"
      :x="stashContextMenu?.x ?? 0"
      :y="stashContextMenu?.y ?? 0"
      :label="stashContextMenu?.stash.ref ?? ''"
      :entries="stashMenuEntries"
      test-id="git-stash-context-menu"
      @close="stashContextMenu = null"
      @select="runStashMenuAction"
    />
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

.git-section-title :deep(.icon-button) {
  /* Let the section header absorb hover from its inline add button. */
  opacity: 0;
}

.git-section-title:hover :deep(.icon-button),
.git-section-title:focus-within :deep(.icon-button) {
  opacity: 1;
}

.git-tree-row {
  display: flex;
  min-height: 26px;
  width: 100%;
  align-items: center;
  gap: 0.35rem;
  border-radius: var(--radius-sm);
  padding: 0 0.35rem 0 0.7rem;
  color: var(--text-secondary);
  font-size: 10.5px;
}

.git-tree-row:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.git-empty-row {
  padding: 0.3rem 0.7rem;
  color: var(--text-disabled);
  font-size: 9.5px;
}
</style>
