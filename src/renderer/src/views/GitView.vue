<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, FolderOpen, GitBranch } from '@lucide/vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import WorktreeSwitcher from '@renderer/components/git/WorktreeSwitcher.vue'
import GitWorkspaceView from '@renderer/components/git/GitWorkspaceView.vue'
import GitDiffView from '@renderer/components/git/GitDiffView.vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useSettingsStore } from '@renderer/stores/settings'
import { getApi } from '@renderer/composables/useApi'

const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const settings = useSettingsStore()
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let unsubWorkspaceChanged: (() => void) | null = null

const hasProjects = computed(() => workspace.sessionProjectGroups.length > 0)
const showWorkingDiff = ref(false)

function scheduleGitRefresh() {
  if (document.visibilityState === 'hidden') return
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void workspace.loadGit()
  }, 240)
}

onMounted(() => {
  void (async () => {
    await sessions.refresh()
    await workspace.restore({
      restoreTabs: settings.settings?.restoreTabs !== false,
      autoOpenLastProject: settings.settings?.autoOpenLastProject !== false
    })
    await workspace.loadGit()
  })()
  window.addEventListener('focus', scheduleGitRefresh)
  document.addEventListener('visibilitychange', scheduleGitRefresh)
  unsubWorkspaceChanged = getApi().on('workspace-changed', scheduleGitRefresh)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  unsubWorkspaceChanged?.()
  window.removeEventListener('focus', scheduleGitRefresh)
  document.removeEventListener('visibilitychange', scheduleGitRefresh)
})

// Projects added or removed in the Workspace appear and disappear here as well.
watch(
  () => workspace.gitRoots,
  () => {
    void workspace.loadGit()
  }
)
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0" data-testid="git-view">
    <div
      v-if="!hasProjects"
      data-testid="git-no-projects"
      class="flex min-h-0 flex-1 items-center justify-center"
    >
      <EmptyState
        :title="$t('workspace.gitNoProjectsTitle')"
        :description="$t('workspace.gitNoProjectsHint')"
        :icon="FolderOpen"
      />
    </div>
    <template v-else>
      <WorktreeSwitcher
        class="w-[272px] shrink-0 overflow-y-auto border-r border-[var(--border-subtle)]"
        @open-diff="showWorkingDiff = true"
      />
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <template v-if="showWorkingDiff">
          <div
            class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3"
          >
            <button
              type="button"
              data-testid="git-back-to-graph"
              class="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[10.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              @click="showWorkingDiff = false"
            >
              <ArrowLeft class="size-3" :stroke-width="1.75" />
              {{ $t('workspace.gitGraph') }}
            </button>
          </div>
          <GitDiffView class="min-h-0 flex-1" />
        </template>
        <GitWorkspaceView
          v-else-if="workspace.gitStatus?.isGitRepository"
          class="min-h-0 flex-1"
        />
        <div v-else class="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            :title="$t('workspace.notGit')"
            :description="$t('workspace.gitNoRepositoryHint')"
            :icon="GitBranch"
          />
        </div>
      </div>
    </template>
  </div>
</template>
