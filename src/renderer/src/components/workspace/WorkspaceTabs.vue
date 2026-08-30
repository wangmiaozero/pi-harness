<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import type { WorkspaceTab } from '@shared/types/workspace'

const props = withDefaults(defineProps<{ scope?: 'main' | 'files' }>(), { scope: 'main' })
const emit = defineEmits<{ 'focus-composer': [] }>()
const { t } = useI18n()

type TabMenuAction = 'close' | 'closeOthers' | 'closeRight' | 'closeLeft' | 'closeAll'

interface TabMenuState {
  tabId: string
  x: number
  y: number
}

const workspace = useWorkspaceStore()
const visibleTabs = computed(() =>
  props.scope === 'files' ? workspace.sessionFileTabs : workspace.mainTabs
)
const selectedId = computed(() =>
  props.scope === 'files' ? workspace.activeFileTab?.id : workspace.activeTabId
)
const menu = ref<TabMenuState | null>(null)
const menuElement = ref<HTMLElement | null>(null)

const targetIndex = computed(() =>
  menu.value ? visibleTabs.value.findIndex((tab) => tab.id === menu.value?.tabId) : -1
)
const targetTab = computed(() =>
  menu.value ? (visibleTabs.value.find((tab) => tab.id === menu.value?.tabId) ?? null) : null
)
const menuStyle = computed(() => ({
  left: `${menu.value?.x ?? 0}px`,
  top: `${menu.value?.y ?? 0}px`
}))
const enabledMenuItemClass =
  'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none active:bg-[var(--accent-tint)]'
const disabledMenuItemClass =
  'cursor-not-allowed bg-transparent text-[var(--text-disabled)] opacity-70'

function actionEnabled(action: TabMenuAction): boolean {
  switch (action) {
    case 'close':
      return targetTab.value?.closable === true
    case 'closeOthers':
      return visibleTabs.value.length > 1
    case 'closeRight':
      return targetIndex.value >= 0 && targetIndex.value < visibleTabs.value.length - 1
    case 'closeLeft':
      return targetIndex.value > 0
    case 'closeAll':
      return visibleTabs.value.length > 0
  }
}

function menuItemClass(action: TabMenuAction): string {
  return actionEnabled(action) ? enabledMenuItemClass : disabledMenuItemClass
}

async function openMenu(tab: WorkspaceTab, event: MouseEvent) {
  menu.value = { tabId: tab.id, x: event.clientX, y: event.clientY }
  await nextTick()
  const element = menuElement.value
  if (!element || !menu.value) return
  const rect = element.getBoundingClientRect()
  menu.value = {
    ...menu.value,
    x: Math.max(8, Math.min(menu.value.x, window.innerWidth - rect.width - 8)),
    y: Math.max(8, Math.min(menu.value.y, window.innerHeight - rect.height - 8))
  }
}

function tabsAffectedBy(action: TabMenuAction, tabId: string): WorkspaceTab[] {
  const tabs = visibleTabs.value
  const index = tabs.findIndex((tab) => tab.id === tabId)
  if (index === -1) return []
  switch (action) {
    case 'close':
      return [tabs[index]]
    case 'closeOthers':
      return tabs.filter((tab) => tab.id !== tabId)
    case 'closeRight':
      return tabs.slice(index + 1)
    case 'closeLeft':
      return tabs.slice(0, index)
    case 'closeAll':
      return [...tabs]
  }
}

async function confirmDiscard(tabs: WorkspaceTab[]): Promise<boolean> {
  const dirtyPaths = [
    ...new Set(
      tabs
        .filter((tab) => tab.kind === 'file' && workspace.isFileDirty(tab.filePath))
        .map((tab) => tab.filePath!)
    )
  ]
  if (!dirtyPaths.length) return true
  const confirmed = await askConfirm({
    title: t('workspace.fileDiscardTitle'),
    description: t('workspace.fileDiscardConfirm'),
    confirmLabel: t('workspace.fileDiscardAction'),
    tone: 'danger'
  })
  if (confirmed) dirtyPaths.forEach((path) => workspace.discardFileEditBuffer(path))
  return confirmed
}

async function executeAction(action: TabMenuAction, tabId: string) {
  const affected = tabsAffectedBy(action, tabId)
  if (!(await confirmDiscard(affected))) return
  // File actions never close chats, and main-tab actions never discard file buffers.
  affected.forEach((tab) => workspace.closeTab(tab.id))
  if (action !== 'close' && action !== 'closeAll') workspace.activateTab(tabId)
}

function runAction(action: TabMenuAction) {
  const tabId = menu.value?.tabId
  if (!tabId || !actionEnabled(action)) return
  closeMenu()
  void executeAction(action, tabId)
}

async function requestCloseTab(tabId: string) {
  const tab = workspace.tabs.find((item) => item.id === tabId)
  if (!tab?.closable) return
  await executeAction('close', tabId)
}

function activateTab(tab: WorkspaceTab) {
  workspace.activateTab(tab.id)
  if (tab.kind === 'chat') emit('focus-composer')
}

function closeMenu() {
  menu.value = null
}

function onDocumentPointer(event: PointerEvent) {
  if (menuElement.value?.contains(event.target as Node)) return
  closeMenu()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer, true)
  document.addEventListener('keydown', onDocumentKeydown, true)
  window.addEventListener('blur', closeMenu)
  window.addEventListener('resize', closeMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer, true)
  document.removeEventListener('keydown', onDocumentKeydown, true)
  window.removeEventListener('blur', closeMenu)
  window.removeEventListener('resize', closeMenu)
})

defineExpose({ requestCloseTab })
</script>

<template>
  <div
    :data-testid="scope === 'files' ? 'workspace-file-tabs' : 'workspace-tabs'"
    class="flex min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[var(--border-subtle)] px-1"
    :class="scope === 'files' ? 'h-9' : 'mission-tabs h-[var(--height-page-header)] flex-1'"
  >
    <button
      v-for="tab in visibleTabs"
      :key="tab.id"
      type="button"
      class="group flex h-7 max-w-[180px] items-center gap-1 rounded-[var(--radius-sm)] border border-transparent px-2 text-[11.5px] transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] active:border-[var(--accent-border)] active:bg-[var(--accent-tint-strong)]"
      :class="
        selectedId === tab.id
          ? 'border-[var(--accent-border)] bg-[var(--bg-surface-raised)] text-[var(--text-primary)] shadow-[inset_0_-2px_0_var(--accent)]'
          : 'text-[var(--text-tertiary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
      "
      :aria-pressed="selectedId === tab.id"
      :data-tab-id="tab.id"
      @click="activateTab(tab)"
      @contextmenu.prevent.stop="openMenu(tab, $event)"
    >
      <span class="truncate">{{ tab.title }}</span>
      <span
        v-if="tab.kind === 'file' && workspace.isFileDirty(tab.filePath)"
        class="size-1.5 shrink-0 rounded-full bg-[var(--warning)]"
        :title="$t('workspace.fileUnsaved')"
      />
      <span
        v-if="tab.closable"
        class="rounded p-0.5 opacity-0 hover:bg-[var(--bg-hover)] group-hover:opacity-100"
        @click.stop="requestCloseTab(tab.id)"
      >
        <X class="size-3" :stroke-width="1.75" />
      </span>
    </button>
  </div>

  <Teleport to="body">
    <div
      v-if="menu"
      ref="menuElement"
      role="menu"
      data-testid="tab-context-menu"
      :aria-label="$t('workspace.tabContextMenu')"
      class="fixed z-[120] min-w-[210px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-popover)]"
      :style="menuStyle"
      @contextmenu.prevent
      @pointerdown.stop
    >
      <button
        type="button"
        role="menuitem"
        :disabled="!actionEnabled('close')"
        class="flex w-full rounded-[4px] px-2 py-1.5 text-left text-[12.5px] transition-colors"
        :class="menuItemClass('close')"
        @mousedown.prevent="runAction('close')"
      >
        {{ $t('workspace.closeTab') }}
      </button>
      <button
        type="button"
        role="menuitem"
        :disabled="!actionEnabled('closeOthers')"
        class="flex w-full rounded-[4px] px-2 py-1.5 text-left text-[12.5px] transition-colors"
        :class="menuItemClass('closeOthers')"
        @mousedown.prevent="runAction('closeOthers')"
      >
        {{ $t('workspace.closeOtherTabs') }}
      </button>
      <button
        type="button"
        role="menuitem"
        :disabled="!actionEnabled('closeRight')"
        class="flex w-full rounded-[4px] px-2 py-1.5 text-left text-[12.5px] transition-colors"
        :class="menuItemClass('closeRight')"
        @mousedown.prevent="runAction('closeRight')"
      >
        {{ $t('workspace.closeTabsToRight') }}
      </button>
      <button
        type="button"
        role="menuitem"
        :disabled="!actionEnabled('closeLeft')"
        class="flex w-full rounded-[4px] px-2 py-1.5 text-left text-[12.5px] transition-colors"
        :class="menuItemClass('closeLeft')"
        @mousedown.prevent="runAction('closeLeft')"
      >
        {{ $t('workspace.closeTabsToLeft') }}
      </button>
      <div class="mx-1 my-1 h-px bg-[var(--border-subtle)]" />
      <button
        type="button"
        role="menuitem"
        :disabled="!actionEnabled('closeAll')"
        class="flex w-full rounded-[4px] px-2 py-1.5 text-left text-[12.5px] transition-colors"
        :class="menuItemClass('closeAll')"
        @mousedown.prevent="runAction('closeAll')"
      >
        {{ $t('workspace.closeAllTabs') }}
      </button>
    </div>
  </Teleport>
</template>
