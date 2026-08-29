<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ChevronDown, ChevronRight, Folder, LoaderCircle, RefreshCw, Upload } from '@lucide/vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useSessionStore } from '@renderer/stores/sessions'
import { callApi, getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import IconButton from '@renderer/components/ui/IconButton.vue'
import FileTreeNode from '@renderer/components/files/FileTreeNode.vue'
import { FILE_TREE_API, type FileTreeApi } from '@renderer/components/files/file-tree-api'
import type { FileSearchHit, FileTreeEntry } from '@shared/types/workspace'
import { FILE_UPLOAD_MAX_BYTES } from '@shared/workspace/file-types'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const sessions = useSessionStore()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const expanded = ref<string[]>([])
const selectedDirectory = ref<string | null>(null)
const searchQuery = ref('')
const searchHits = ref<FileSearchHit[]>([])
const searching = ref(false)

const folders = computed(() =>
  sessions.currentId &&
  sessions.current &&
  workspace.activeSessionWorkspaceId === sessions.currentId
    ? workspace.workspaceFolders
    : []
)
const currentDirectory = computed(
  () => selectedDirectory.value ?? workspace.listedPath ?? workspace.currentCwd
)
const currentReadonly = computed(() => workspace.isPathReadonly(currentDirectory.value))

watch(
  folders,
  (next) => {
    const roots = next.map((folder) => folder.resolvedPath)
    expanded.value = [
      ...new Set([
        ...expanded.value.filter((directory) => workspace.folderForPath(directory)),
        ...roots
      ])
    ]
    if (!selectedDirectory.value || !workspace.folderForPath(selectedDirectory.value)) {
      selectedDirectory.value = next[0]?.resolvedPath ?? null
      searchHits.value = []
    }
  },
  { immediate: true }
)

function isExpanded(path: string): boolean {
  return expanded.value.includes(path)
}

async function toggleDir(path: string) {
  selectedDirectory.value = path
  if (isExpanded(path)) {
    expanded.value = expanded.value.filter((item) => item !== path)
    return
  }
  expanded.value = [...expanded.value, path]
  if (!workspace.fileChildren[path]) await workspace.loadDirectory(path).catch(() => [])
}

async function openEntry(entry: FileTreeEntry) {
  if (entry.isDirectory) {
    await toggleDir(entry.path)
    return
  }
  workspace.openFileTab(entry.path, entry.name)
}

function childrenOf(path: string): FileTreeEntry[] {
  return workspace.fileChildren[path] ?? []
}

provide<FileTreeApi>(FILE_TREE_API, { isExpanded, childrenOf, openEntry })

async function refreshTree() {
  await workspace.refreshContent()
  await Promise.all(expanded.value.map((path) => workspace.loadDirectory(path).catch(() => [])))
}

function chooseFiles() {
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = Array.from(input.files ?? [])
  const targetDirectory = currentDirectory.value
  if (!selected.length || !targetDirectory || uploading.value || currentReadonly.value) {
    input.value = ''
    return
  }

  const oversized = selected.filter((file) => file.size > FILE_UPLOAD_MAX_BYTES)
  if (oversized.length) {
    toast.warning(t('workspace.uploadTooLarge', { size: FILE_UPLOAD_MAX_BYTES / 1024 / 1024 }))
  }

  const files = selected.filter((file) => file.size <= FILE_UPLOAD_MAX_BYTES)
  if (!files.length) {
    input.value = ''
    return
  }

  uploading.value = true
  let uploaded = 0
  let currentName = ''
  try {
    for (const file of files) {
      currentName = file.name
      const base64 = await readFileBase64(file)
      try {
        await uploadFile(targetDirectory, file.name, base64, false)
        uploaded += 1
      } catch (error) {
        if (isFileExistsError(error)) {
          const replace = await askConfirm({
            title: t('workspace.overwriteFileTitle'),
            description: t('workspace.overwriteFileConfirm', { name: file.name }),
            confirmLabel: t('workspace.overwriteFileAction'),
            tone: 'primary'
          })
          if (!replace) continue
          await uploadFile(targetDirectory, file.name, base64, true)
          uploaded += 1
          continue
        }
        throw error
      }
    }
  } catch (error) {
    toast.error(
      t('workspace.uploadFailed', {
        name: currentName,
        message: errorMessage(error)
      })
    )
  } finally {
    uploading.value = false
    input.value = ''
  }

  if (uploaded > 0) {
    await workspace.loadDirectory(targetDirectory)
    toast.success(t('workspace.uploadComplete', { count: uploaded }))
  }
}

async function uploadFile(directory: string, fileName: string, base64: string, overwrite: boolean) {
  await callApi(() => getApi().files.upload(directory, fileName, base64, overwrite))
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const separator = result.indexOf(',')
      if (separator === -1) {
        reject(new Error('Unable to read file'))
        return
      }
      resolve(result.slice(separator + 1))
    }
    reader.readAsDataURL(file)
  })
}

function isFileExistsError(error: unknown): boolean {
  return errorMessage(error).includes('File already exists')
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return error instanceof Error ? error.message : String(error)
}

async function runSearch() {
  const query = searchQuery.value.trim()
  if (!query) {
    searchHits.value = []
    return
  }
  searching.value = true
  try {
    searchHits.value = await workspace.searchFiles(query)
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    searching.value = false
  }
}
</script>

<template>
  <div
    class="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-1.5 py-1"
  >
    <div class="flex h-7 items-center gap-1">
      <span
        class="min-w-0 flex-1 truncate px-1 text-[10.5px] text-[var(--text-tertiary)]"
        :title="currentDirectory ?? ''"
      >
        {{ $t('workspace.files') }}
      </span>
      <IconButton
        :label="$t('workspace.uploadFiles')"
        :disabled="!currentDirectory || uploading || currentReadonly"
        @click="chooseFiles"
      >
        <LoaderCircle v-if="uploading" class="size-3.5 animate-spin" :stroke-width="1.75" />
        <Upload v-else class="size-3.5" :stroke-width="1.75" />
      </IconButton>
      <IconButton
        :label="$t('workspace.refreshFiles')"
        :disabled="workspace.filesLoading"
        @click="refreshTree"
      >
        <RefreshCw
          class="size-3.5"
          :class="workspace.filesLoading ? 'animate-spin' : ''"
          :stroke-width="1.75"
        />
      </IconButton>
      <input
        ref="fileInput"
        data-testid="file-upload-input"
        type="file"
        multiple
        class="hidden"
        @change="onFileChange"
      />
    </div>
    <div class="mt-1 flex gap-1">
      <input
        v-model="searchQuery"
        class="h-7 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-[11px] text-[var(--text-primary)]"
        :placeholder="$t('workspace.searchPlaceholder')"
        @keydown.enter="runSearch"
      />
      <button
        type="button"
        class="h-7 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-[10.5px] text-[var(--text-secondary)]"
        :disabled="searching"
        @click="runSearch"
      >
        {{ searching ? '…' : $t('common.search') }}
      </button>
    </div>
  </div>

  <ul v-if="searchHits.length" class="px-1 py-1">
    <li v-for="hit in searchHits" :key="hit.absolutePath + String(hit.line ?? '')">
      <button
        class="flex w-full flex-col rounded-[var(--radius-sm)] px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
        @click="
          workspace.openFileTab(
            hit.absolutePath,
            hit.relativePath.split('/').pop() ?? hit.relativePath
          )
        "
      >
        <span class="text-[10.5px] text-[var(--text-tertiary)]">{{ hit.workspaceFolderName }}</span>
        <span class="truncate text-[12px] text-[var(--text-secondary)]">{{
          hit.relativePath
        }}</span>
        <span v-if="hit.preview" class="truncate text-[10.5px] text-[var(--text-tertiary)]">
          {{ hit.line ? `${hit.line}: ` : '' }}{{ hit.preview }}
        </span>
      </button>
    </li>
  </ul>

  <ul v-else class="px-1 py-1">
    <li v-for="folder in folders" :key="folder.id">
      <button
        class="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        @click="toggleDir(folder.resolvedPath)"
      >
        <ChevronDown
          v-if="isExpanded(folder.resolvedPath)"
          class="size-3 shrink-0"
          :stroke-width="1.75"
        />
        <ChevronRight v-else class="size-3 shrink-0" :stroke-width="1.75" />
        <Folder class="size-3.5 shrink-0" :stroke-width="1.75" />
        <span class="min-w-0 flex-1 truncate">{{ folder.name }}</span>
        <span class="text-[10px] text-[var(--text-tertiary)]">
          {{ folder.exists === false ? $t('workspace.missingFolder') : '' }}
        </span>
      </button>
      <ul v-if="isExpanded(folder.resolvedPath) && folder.exists" class="ml-4">
        <FileTreeNode
          v-for="entry in childrenOf(folder.resolvedPath)"
          :key="entry.path"
          :entry="entry"
        />
      </ul>
    </li>
    <li
      v-if="!workspace.filesLoading && !folders.length"
      class="px-2 py-4 text-center text-[11px] text-[var(--text-tertiary)]"
    >
      {{ $t('workspace.noFiles') }}
    </li>
  </ul>
</template>
