<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ChevronRight,
  Columns2,
  FileDiff,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  PanelRight,
  Rows3,
  Search
} from '@lucide/vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import UnifiedDiffPreview from '@renderer/components/git/UnifiedDiffPreview.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'

const workspace = useWorkspaceStore()
type ChangeFile = NonNullable<typeof workspace.changePreview>['files'][number]
type ChangeNode =
  | { kind: 'folder'; key: string; name: string; children: Map<string, ChangeNode> }
  | { kind: 'file'; key: string; name: string; file: ChangeFile }

const query = ref('')
const split = ref(true)
const showFileTree = ref(true)
const collapsedFolders = ref(new Set<string>())
const collapsedDiff = ref(false)
const fileList = ref<HTMLElement | null>(null)
const diffList = ref<HTMLElement | null>(null)

const files = computed(() => workspace.changePreview?.files ?? [])
const selected = computed(
  () =>
    files.value.find((file) => file.path === workspace.changePreview?.selectedPath) ??
    files.value[0]
)
const totals = computed(() =>
  files.value.reduce(
    (total, file) => ({
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions
    }),
    { additions: 0, deletions: 0 }
  )
)
const search = computed(() => query.value.trim().toLowerCase().replace(/\\/g, '/'))

function displayParts(file: ChangeFile): string[] {
  return file.displayPath.split(/[\\/]/).filter(Boolean)
}

function matchesSearch(file: ChangeFile): boolean {
  return file.displayPath.toLowerCase().replace(/\\/g, '/').includes(search.value)
}

const fileTree = computed(() => {
  const roots = new Map<string, ChangeNode>()
  for (const file of files.value.filter(matchesSearch)) {
    const parts = displayParts(file)
    const name = parts.pop() ?? file.displayPath
    let children = roots
    let directory = ''
    for (const part of parts) {
      directory += '/' + part
      const key = 'folder:' + directory
      let folder = children.get(key)
      if (!folder || folder.kind !== 'folder') {
        folder = { kind: 'folder', key, name: part, children: new Map() }
        children.set(key, folder)
      }
      children = folder.children
    }
    const key = 'file:' + file.path
    children.set(key, { kind: 'file', key, name, file })
  }
  return roots
})

const visibleRows = computed(() => {
  const rows: { node: ChangeNode; depth: number }[] = []
  function append(children: Map<string, ChangeNode>, depth: number): void {
    for (const node of children.values()) {
      rows.push({ node, depth })
      if (node.kind === 'folder' && (search.value || !collapsedFolders.value.has(node.key))) {
        append(node.children, depth + 1)
      }
    }
  }
  append(fileTree.value, 0)
  return rows
})

function toggleFolder(key: string): void {
  if (collapsedFolders.value.has(key)) collapsedFolders.value.delete(key)
  else collapsedFolders.value.add(key)
}

function selectFile(file: ChangeFile): void {
  const preview = workspace.changePreview
  if (preview) workspace.changePreview = { ...preview, selectedPath: file.path }
}

function toggleDiff(file: ChangeFile): void {
  if (file.path === selected.value?.path) collapsedDiff.value = !collapsedDiff.value
  else selectFile(file)
}

function openSelectedFile(file: ChangeFile): void {
  workspace.openFileTab(file.path, displayParts(file).at(-1) ?? file.displayPath)
}

watch(
  () => workspace.changePreview,
  (preview, previous) => {
    if (preview?.runId !== previous?.runId) {
      query.value = ''
      collapsedFolders.value.clear()
    }
    collapsedDiff.value = false
    const file = selected.value
    if (!file) return
    if (!matchesSearch(file)) query.value = ''
    const parts = displayParts(file).slice(0, -1)
    let directory = ''
    for (const part of parts) {
      directory += '/' + part
      collapsedFolders.value.delete('folder:' + directory)
    }
  },
  { immediate: true }
)

watch(
  [fileList, () => workspace.changePreview],
  ([list]) => {
    const row = list?.querySelector('button[aria-pressed="true"]')
    if (!list || !row) return
    const top = list.getBoundingClientRect().top
    const bounds = row.getBoundingClientRect()
    const margin = 4
    const bottom = top + list.clientHeight - margin
    if (bounds.top < top + margin) list.scrollTop += bounds.top - top - margin
    else if (bounds.bottom > bottom) list.scrollTop += bounds.bottom - bottom
  },
  { flush: 'post' }
)

function scrollToSelectedDiff(): void {
  const list = diffList.value
  const header = list?.querySelector('[data-selected-diff="true"]')
  if (!list || !header) return
  list.scrollTop += header.getBoundingClientRect().top - list.getBoundingClientRect().top
}

watch([diffList, () => workspace.changePreview, split], scrollToSelectedDiff, { flush: 'post' })
watch(diffList, (list, _, onCleanup) => {
  if (!list) return
  const observer = new ResizeObserver(scrollToSelectedDiff)
  observer.observe(list)
  onCleanup(() => observer.disconnect())
})
</script>

<template>
  <section
    class="run-changes flex min-h-0 flex-1 flex-col overflow-hidden"
    data-testid="run-changes-preview"
  >
    <header
      class="flex min-h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-2.5"
    >
      <span class="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--text-primary)]">
        {{ $t('workspace.fileChangesEdited', { count: files.length }) }}
      </span>
      <span class="whitespace-nowrap font-[family-name:var(--font-mono)] text-[11px]">
        <span class="text-[var(--success)]">+{{ totals.additions }}</span>
        <span class="ml-1 text-[var(--danger)]">-{{ totals.deletions }}</span>
      </span>
      <div class="flex shrink-0 gap-0.5 border-s border-[var(--border-default)] ps-1.5">
        <IconButton
          :label="split ? $t('workspace.diffUnified') : $t('workspace.diffSplit')"
          data-testid="changes-diff-layout"
          @click="split = !split"
        >
          <Columns2 v-if="split" class="size-3.5" />
          <Rows3 v-else class="size-3.5" />
        </IconButton>
        <IconButton
          :label="$t('workspace.fileTreeMode')"
          :active="showFileTree"
          :aria-pressed="showFileTree"
          data-testid="changes-toggle-tree"
          @click="showFileTree = !showFileTree"
        >
          <PanelRight class="size-3.5" />
        </IconButton>
      </div>
    </header>

    <div class="changes-layout" :class="{ 'changes-layout--with-tree': showFileTree }">
      <div ref="diffList" class="changes-diffs" data-testid="changes-diff-list">
        <section
          v-for="file in files"
          :key="file.path"
          class="border-b border-[var(--border-subtle)]"
        >
          <div class="change-header" :data-selected-diff="file.path === selected?.path">
            <button
              type="button"
              class="change-header-button"
              :title="file.displayPath"
              :aria-expanded="file.path === selected?.path && !collapsedDiff"
              @click="toggleDiff(file)"
            >
              <ChevronRight
                class="size-3.5 shrink-0 transition-transform"
                :class="{ 'rotate-90': file.path === selected?.path && !collapsedDiff }"
              />
              <FileDiff class="size-3.5 shrink-0 text-[var(--accent)]" />
              <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span class="shrink-0 max-w-full truncate font-medium text-[var(--text-primary)]">{{
                  displayParts(file).at(-1)
                }}</span>
                <span class="truncate text-[10.5px] text-[var(--text-tertiary)]">{{
                  displayParts(file).slice(0, -1).join('/')
                }}</span>
              </span>
              <span class="whitespace-nowrap text-[10.5px] tabular-nums">
                <span class="text-[var(--success)]">+{{ file.additions }}</span>
                <span class="ml-1 text-[var(--danger)]">-{{ file.deletions }}</span>
              </span>
            </button>
            <div v-if="file.path === selected?.path" class="flex shrink-0 items-center pe-1">
              <IconButton
                :label="$t('common.open')"
                :disabled="!workspace.folderForPath(file.path)"
                class="!size-6"
                data-testid="changes-open-file"
                @click="openSelectedFile(file)"
              >
                <FileText class="size-3.5" />
              </IconButton>
              <IconButton
                :label="$t('workspace.revealFile')"
                :disabled="!workspace.folderForPath(file.path)"
                class="!size-6"
                data-testid="changes-reveal-file"
                @click="workspace.revealFileInTree(file.path)"
              >
                <FolderSearch class="size-3.5" />
              </IconButton>
            </div>
          </div>
          <template v-if="file.path === selected?.path && !collapsedDiff">
            <UnifiedDiffPreview v-if="file.patch" :patch="file.patch" :split="split" />
            <p v-else class="p-4 text-xs text-[var(--text-tertiary)]">
              {{ $t('workspace.noDiff') }}
            </p>
          </template>
        </section>
      </div>

      <aside v-if="showFileTree" class="changes-tree" :aria-label="$t('workspace.fileTreeMode')">
        <label class="changes-filter">
          <Search class="size-3.5 shrink-0" />
          <input
            v-model="query"
            type="search"
            :aria-label="$t('workspace.changesFilterFiles')"
            :placeholder="$t('workspace.changesFilterFiles')"
            data-testid="changes-file-filter"
            @keydown.esc.stop="query = ''"
          />
        </label>
        <div ref="fileList" class="changes-tree-list" data-testid="changes-file-tree">
          <template v-for="{ node, depth } in visibleRows" :key="node.key">
            <button
              v-if="node.kind === 'folder'"
              type="button"
              class="changes-tree-row"
              :style="{ '--changes-indent': Math.min(depth, 5) * 9 + 5 + 'px' }"
              :aria-expanded="Boolean(search) || !collapsedFolders.has(node.key)"
              :disabled="Boolean(search)"
              :title="node.name"
              @click="toggleFolder(node.key)"
            >
              <ChevronRight
                class="size-3 shrink-0 transition-transform"
                :class="{ 'rotate-90': search || !collapsedFolders.has(node.key) }"
              />
              <Folder v-if="!search && collapsedFolders.has(node.key)" class="size-3.5 shrink-0" />
              <FolderOpen v-else class="size-3.5 shrink-0" />
              <span class="truncate">{{ node.name }}</span>
            </button>
            <button
              v-else
              type="button"
              class="changes-tree-row changes-tree-file"
              :style="{ '--changes-indent': Math.min(depth, 5) * 9 + 5 + 'px' }"
              :aria-label="node.file.displayPath"
              :aria-pressed="selected?.path === node.file.path"
              :title="node.file.displayPath"
              @click="selectFile(node.file)"
            >
              <FileText class="size-3.5 shrink-0" />
              <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
              <span class="shrink-0 whitespace-nowrap text-[10px] tabular-nums">
                <span class="text-[var(--success)]">+{{ node.file.additions }}</span>
                <span class="ml-1 text-[var(--danger)]">-{{ node.file.deletions }}</span>
              </span>
            </button>
          </template>
          <p
            v-if="!visibleRows.length"
            class="px-2 py-2 text-xs text-[var(--text-tertiary)] [overflow-wrap:anywhere]"
          >
            {{ $t('workspace.gitNoMatches', { query: query.trim() }) }}
          </p>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.run-changes {
  container: run-changes / inline-size;
}

.changes-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.changes-diffs {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  overflow-anchor: none;
  overscroll-behavior: contain;
}

.change-header {
  display: flex;
  min-width: 0;
  min-height: 32px;
  background: var(--bg-surface-raised);
  border-inline-start: 2px solid transparent;
}

.change-header[data-selected-diff='true'] {
  border-inline-start-color: var(--accent);
  background: color-mix(in srgb, var(--accent-tint) 45%, var(--bg-surface-raised));
}

.change-header-button,
.changes-tree-row {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
  color: var(--text-secondary);
  text-align: start;
  font-size: 12px;
}

.change-header-button {
  flex: 1;
  padding: 4px 8px;
}

.change-header-button:hover,
.changes-tree-row:not(:disabled):hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.change-header-button:focus-visible,
.changes-tree-row:focus-visible {
  outline-offset: -2px;
}

.changes-tree {
  display: flex;
  flex-direction: column;
  flex: 0 0 clamp(170px, 31%, 245px);
  min-width: 0;
  min-height: 0;
  border-inline-start: 1px solid var(--border-subtle);
  background: var(--bg-sidebar);
}

.changes-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 8px 4px;
  padding: 0 7px;
  min-height: 29px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-tertiary);
}

.changes-filter:focus-within {
  border-color: var(--accent-border);
  box-shadow: var(--focus-ring);
}

.changes-filter input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-primary);
  outline: none;
}

.changes-tree-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 5px 8px;
}

.changes-tree-row {
  width: 100%;
  min-height: 27px;
  padding-inline: var(--changes-indent) 6px;
  border-radius: var(--radius-sm);
}

.changes-tree-file[aria-pressed='true'] {
  color: var(--accent);
  background: var(--accent-tint);
  box-shadow: inset 0 0 0 1px var(--accent-border);
}

@container run-changes (max-width: 510px) {
  .changes-layout--with-tree {
    flex-direction: column-reverse;
  }

  .changes-tree {
    flex: 0 1 auto;
    max-height: 36%;
    border-inline-start: 0;
    border-bottom: 1px solid var(--border-subtle);
  }
}
</style>
