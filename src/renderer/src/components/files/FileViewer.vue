<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { CircleAlert, File, LoaderCircle, Save } from '@lucide/vue'
import { graphiteEditorTheme, graphiteSyntaxHighlighting } from '@renderer/styles/codemirror'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi, getErrorPayload } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { formatBytes } from '@renderer/utils/format'
import type { FilePreview } from '@shared/types/workspace'
import Button from '@renderer/components/ui/Button.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const preview = ref<FilePreview | null>(null)
const loading = ref(false)
const saving = ref(false)
const loadError = ref<string | null>(null)
const host = ref<HTMLElement | null>(null)
const objectUrl = ref<string | null>(null)
const detectedLanguage = ref<string | null>(null)
let view: EditorView | null = null
let loadVersion = 0
let editorVersion = 0

const filePath = computed(() => workspace.activeTab?.filePath ?? null)
const editBuffer = computed(() => {
  const path = filePath.value
  return path ? workspace.fileEditBuffers[path] : undefined
})
const currentText = computed(() => {
  if (editBuffer.value) return editBuffer.value.content
  return preview.value?.kind === 'text' ? (preview.value.text ?? '') : ''
})
const dirty = computed(() => workspace.isFileDirty(filePath.value))
const editable = computed(
  () => preview.value?.kind === 'text' && !preview.value.truncated && Boolean(editBuffer.value)
)
const lineCount = computed(() => (currentText.value.match(/\n/g)?.length ?? 0) + 1)
const displayPath = computed(() => {
  const file = preview.value
  if (!file) return ''
  const normalizedPath = file.path.replace(/\\/g, '/')
  const normalizedRoot = workspace.currentCwd?.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath
})

const fileEditorTheme = EditorView.theme({
  '.cm-content': { padding: '12px 0', minHeight: '100%' },
  '.cm-line': { paddingLeft: '14px', paddingRight: '24px' },
  '.cm-gutters': { paddingTop: '12px' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '44px' }
})

watch(
  [filePath, () => workspace.contentRevision],
  async ([path]) => {
    const version = ++loadVersion
    destroyEditor()
    revokeObjectUrl()
    preview.value = null
    detectedLanguage.value = null
    loadError.value = null
    loading.value = Boolean(path)
    if (!path) return

    try {
      const next = await callApi(() => getApi().files.read(path))
      if (version !== loadVersion) return
      if (next.kind === 'text' && !next.truncated && next.revision) {
        workspace.ensureFileEditBuffer(next.path, next.text ?? '', next.revision)
      }
      preview.value = next
    } catch (error) {
      if (version !== loadVersion) return
      loadError.value = getErrorMessage(error)
    } finally {
      if (version === loadVersion) loading.value = false
    }
  },
  { immediate: true }
)

watch(
  preview,
  async (next) => {
    const version = ++editorVersion
    destroyEditor()
    revokeObjectUrl()
    if (!next) return

    if (next.base64 && next.mime) {
      objectUrl.value = createObjectUrl(next.base64, next.mime)
    }

    if (next.kind !== 'text') return

    const language = await loadLanguage(next.name)
    if (version !== editorVersion || preview.value !== next) return
    detectedLanguage.value = language.label

    await nextTick()
    if (version !== editorVersion || preview.value !== next || !host.value) return

    const canEdit = !next.truncated && Boolean(workspace.fileEditBuffers[next.path])
    view = new EditorView({
      parent: host.value,
      state: EditorState.create({
        doc: workspace.fileEditBuffers[next.path]?.content ?? next.text ?? '',
        extensions: [
          basicSetup,
          language.extension,
          graphiteEditorTheme,
          graphiteSyntaxHighlighting,
          fileEditorTheme,
          EditorState.readOnly.of(!canEdit),
          EditorState.tabSize.of(2),
          EditorView.editable.of(canEdit),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                void saveFile()
                return true
              }
            }
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && canEdit) {
              workspace.updateFileEditBuffer(next.path, update.state.doc.toString())
            }
          }),
          EditorView.contentAttributes.of({
            'aria-label': `${next.name} ${canEdit ? t('workspace.fileEditor') : t('workspace.filePreview')}`,
            spellcheck: 'false'
          })
        ]
      })
    })
  },
  { flush: 'post' }
)

async function loadLanguage(fileName: string): Promise<{ extension: Extension; label: string }> {
  const description = LanguageDescription.matchFilename(languages, fileName)
  if (!description) return { extension: [], label: t('workspace.filePlainText') }
  try {
    return { extension: await description.load(), label: description.name }
  } catch {
    return { extension: [], label: description.name }
  }
}

async function saveFile(overwrite = false) {
  const path = filePath.value
  const buffer = path ? workspace.fileEditBuffers[path] : undefined
  if (!path || !buffer || !dirty.value || saving.value) return

  saving.value = true
  try {
    const result = await callApi(() =>
      getApi().files.write(path, buffer.content, buffer.revision, overwrite)
    )
    workspace.markFileSaved(path, buffer.content, result.revision)
    if (preview.value?.kind === 'text' && preview.value.path === path) {
      preview.value.size = result.size
      preview.value.text = buffer.content
      preview.value.revision = result.revision
    }
    toast.success(t('workspace.fileSaved'))
    void workspace.loadGit()
  } catch (error) {
    const payload = getErrorPayload(error)
    if (payload.code === 'FILE_CONFLICT' && !overwrite) {
      const confirmed = await askConfirm({
        title: t('workspace.fileConflictTitle'),
        description: t('workspace.fileConflictConfirm'),
        confirmLabel: t('workspace.fileConflictOverwrite'),
        tone: 'danger'
      })
      if (confirmed) {
        saving.value = false
        await saveFile(true)
      }
      return
    }
    toast.error(payload.message || t('workspace.fileSaveFailed'))
  } finally {
    saving.value = false
  }
}

function createObjectUrl(base64: string, mime: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

function destroyEditor() {
  view?.destroy()
  view = null
}

function revokeObjectUrl() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = null
}

onBeforeUnmount(() => {
  loadVersion++
  editorVersion++
  destroyEditor()
  revokeObjectUrl()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-workspace)]">
    <header
      v-if="preview"
      class="flex h-8 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3"
    >
      <div class="flex min-w-0 items-center gap-2">
        <File class="size-3.5 shrink-0 text-[var(--text-tertiary)]" :stroke-width="1.75" />
        <span
          class="truncate font-mono text-[11.5px] text-[var(--text-secondary)]"
          :title="preview.path"
        >
          {{ displayPath }}
        </span>
        <span
          v-if="dirty"
          class="size-1.5 shrink-0 rounded-full bg-[var(--warning)]"
          :title="$t('workspace.fileUnsaved')"
        />
      </div>
      <div class="flex shrink-0 items-center gap-2 text-[10.5px] text-[var(--text-tertiary)]">
        <span v-if="detectedLanguage" class="uppercase">{{ detectedLanguage }}</span>
        <span v-if="preview.kind === 'text'">
          {{ $t('workspace.fileLines', { count: lineCount }) }}
        </span>
        <span>{{ formatBytes(preview.size) }}</span>
        <span v-if="preview.truncated" class="text-[var(--warning)]">
          {{ $t('workspace.fileReadOnlyTruncated') }}
        </span>
        <Button
          v-if="editable"
          variant="secondary"
          size="sm"
          :disabled="!dirty"
          :loading="saving"
          data-testid="file-save"
          @click="saveFile()"
        >
          <Save class="size-3" :stroke-width="1.75" />
          {{ $t('common.save') }}
        </Button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-hidden">
      <EmptyState v-if="loading" :title="$t('common.loading')" :icon="LoaderCircle" />
      <EmptyState
        v-else-if="loadError"
        :title="$t('workspace.fileLoadFailed')"
        :description="loadError"
        :icon="CircleAlert"
      />
      <EmptyState v-else-if="!preview" :title="$t('workspace.noFile')" :icon="File" />
      <div
        v-else-if="preview.kind === 'text'"
        ref="host"
        data-testid="file-code-view"
        class="h-full min-h-0 overflow-hidden"
      />
      <div
        v-else-if="preview.kind === 'image' && objectUrl"
        data-testid="file-image-preview"
        class="flex h-full items-center justify-center overflow-auto p-5"
      >
        <img
          :src="objectUrl"
          :alt="preview.name"
          class="max-h-full max-w-full object-contain"
          decoding="async"
        />
      </div>
      <div v-else-if="preview.kind === 'audio' && objectUrl" class="p-5">
        <audio :src="objectUrl" controls class="w-full" />
      </div>
      <iframe
        v-else-if="preview.kind === 'pdf' && objectUrl"
        :src="objectUrl"
        class="h-full w-full border-0"
        title="PDF"
      />
      <pre
        v-else-if="preview.kind === 'docx'"
        class="h-full overflow-auto whitespace-pre-wrap p-5 text-[13px] text-[var(--text-secondary)]"
        v-text="preview.text"
      />
      <EmptyState v-else :title="$t('workspace.binaryFile')" :icon="File" />
    </div>
  </div>
</template>
