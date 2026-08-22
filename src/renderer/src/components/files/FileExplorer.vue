<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { CornerLeftUp, File, Folder, LoaderCircle, RefreshCw, Upload } from '@lucide/vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import IconButton from '@renderer/components/ui/IconButton.vue'
import type { FileTreeEntry } from '@shared/types/workspace'
import { FILE_UPLOAD_MAX_BYTES } from '@shared/workspace/file-types'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const currentDirectory = computed(() => workspace.listedPath ?? workspace.currentCwd)
const directoryName = computed(() => {
  const directory = currentDirectory.value
  if (!directory) return t('workspace.files')
  const normalized = directory.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() || directory
})

function parentDirectory(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slash <= 0) return trimmed.startsWith('/') ? '/' : trimmed
  const parent = trimmed.slice(0, slash)
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}\\` : parent || '/'
}

function sameDir(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
}

const canGoUp = computed(() => {
  const listed = workspace.listedPath
  const root = workspace.currentCwd
  if (!listed || !root) return false
  return !sameDir(listed, root)
})

async function goUp() {
  const listed = workspace.listedPath
  const root = workspace.currentCwd
  if (!listed || !root) return
  const parent = parentDirectory(listed)
  if (sameDir(parent, listed)) return
  await workspace.loadFiles(parent)
}

async function openEntry(entry: FileTreeEntry) {
  if (entry.isDirectory) {
    await workspace.loadFiles(entry.path)
    return
  }
  workspace.openFileTab(entry.path, entry.name)
}

function chooseFiles() {
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = Array.from(input.files ?? [])
  const targetDirectory = currentDirectory.value
  if (!selected.length || !targetDirectory || uploading.value) {
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
    await workspace.refreshContent(targetDirectory)
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
</script>

<template>
  <div
    class="sticky top-0 z-10 flex h-8 items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-1.5"
  >
    <span
      class="min-w-0 flex-1 truncate px-1 text-[10.5px] text-[var(--text-tertiary)]"
      :title="currentDirectory ?? ''"
    >
      {{ directoryName }}
    </span>
    <IconButton
      :label="$t('workspace.uploadFiles')"
      :disabled="!currentDirectory || uploading"
      @click="chooseFiles"
    >
      <LoaderCircle v-if="uploading" class="size-3.5 animate-spin" :stroke-width="1.75" />
      <Upload v-else class="size-3.5" :stroke-width="1.75" />
    </IconButton>
    <IconButton
      :label="$t('workspace.refreshFiles')"
      :disabled="!currentDirectory || workspace.filesLoading"
      @click="workspace.refreshContent()"
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

  <ul class="px-1 py-1">
    <li v-if="canGoUp">
      <button
        class="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
        @click="goUp"
      >
        <CornerLeftUp class="size-3.5 shrink-0" :stroke-width="1.75" />
        <span class="truncate">{{ $t('workspace.parentDir') }}</span>
      </button>
    </li>
    <li v-for="entry in workspace.files" :key="entry.path">
      <button
        class="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        @click="openEntry(entry)"
      >
        <Folder v-if="entry.isDirectory" class="size-3.5 shrink-0" :stroke-width="1.75" />
        <File v-else class="size-3.5 shrink-0" :stroke-width="1.75" />
        <span class="truncate">{{ entry.name }}</span>
      </button>
    </li>
    <li
      v-if="!workspace.filesLoading && workspace.files.length === 0"
      class="px-2 py-4 text-center text-[11px] text-[var(--text-tertiary)]"
    >
      {{ $t('workspace.noFiles') }}
    </li>
  </ul>
</template>
