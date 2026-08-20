<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { Save, RotateCcw, RefreshCw, AlignLeft, FolderOpen, Circle } from '@lucide/vue'
import { toast } from 'vue-sonner'
import Button from '@renderer/components/ui/Button.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import { graphiteEditorTheme, graphiteSyntaxHighlighting } from '@renderer/styles/codemirror'
import { useConfigStore, type ConfigFile } from '@renderer/stores/config'
import { askConfirm } from '@renderer/composables/useConfirmDialog'

const { t } = useI18n()
const store = useConfigStore()
const host = ref<HTMLElement | null>(null)
const view = shallowRef<EditorView | null>(null)

async function confirmDiscard(): Promise<boolean> {
  if (!store.dirty) return true
  return askConfirm({
    title: t('config.discardTitle'),
    description: t('config.discardConfirm'),
    confirmLabel: t('config.discardAction'),
    tone: 'danger'
  })
}

function mountEditor(doc: string) {
  view.value?.destroy()
  if (!host.value) return
  view.value = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        history(),
        json(),
        graphiteEditorTheme,
        graphiteSyntaxHighlighting,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) store.setDraft(u.state.doc.toString())
        })
      ]
    })
  })
}

watch(
  () => store.raw?.content,
  (content) => {
    if (content == null || !view.value) return
    if (view.value.state.doc.toString() === content) return
    view.value.dispatch({
      changes: { from: 0, to: view.value.state.doc.length, insert: content }
    })
  }
)

async function switchFile(file: ConfigFile) {
  if (!(await confirmDiscard())) return
  await store.load(file)
  mountEditor(store.draft)
}

async function save() {
  const ok = await askConfirm({
    title: t('config.saveTitle'),
    description: t('config.saveConfirm'),
    confirmLabel: t('config.saveAction'),
    tone: 'danger'
  })
  if (!ok) return
  try {
    await store.save()
    if (store.error) {
      toast.error(store.error)
    } else {
      toast.success(t('config.saved'))
      mountEditor(store.draft)
    }
  } catch (e) {
    const msg = (e as { message?: string }).message ?? t('config.saveFailed')
    toast.error(msg)
  }
}

async function reload() {
  if (!(await confirmDiscard())) return
  await store.reload()
  mountEditor(store.draft)
  toast.success(t('config.reloaded'))
}

async function resetDraft() {
  if (!(await confirmDiscard())) return
  store.setDraft(store.raw?.content ?? '')
  mountEditor(store.draft)
}

function formatJson() {
  try {
    const parsed = JSON.parse(store.draft)
    const pretty = JSON.stringify(parsed, null, 2) + '\n'
    store.setDraft(pretty)
    if (view.value) {
      view.value.dispatch({
        changes: { from: 0, to: view.value.state.doc.length, insert: pretty }
      })
    }
    toast.success(t('config.formatted'))
  } catch (e) {
    const msg = (e as Error).message
    // Try to surface line/column when V8 provides it
    const m = /position\s+(\d+)/i.exec(msg)
    let detail = msg
    if (m) {
      const pos = Number(m[1])
      const before = store.draft.slice(0, pos)
      const line = before.split('\n').length
      const col = before.length - before.lastIndexOf('\n')
      detail = `${msg} (line ${line}, col ${col})`
    }
    store.error = detail
    toast.error(`${t('config.invalid')}: ${detail}`)
  }
}

async function revealFile() {
  if (!store.raw?.path) return
  try {
    const { getApi } = await import('@renderer/composables/useApi')
    await getApi().system.showItem(store.raw.path)
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('config.revealFailed'))
  }
}

onMounted(async () => {
  await store.load('models')
  mountEditor(store.draft)
})

onBeforeUnmount(() => {
  view.value?.destroy()
  view.value = null
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Editor-style header: file selector as a tab strip, actions on the right. -->
    <header
      class="flex shrink-0 items-center justify-between gap-3 px-5 h-[var(--height-page-header)] border-b border-[var(--border-subtle)]"
    >
      <div class="min-w-0 flex items-center gap-3">
        <h1 class="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          {{ $t('nav.config') }}
        </h1>
        <p class="text-[11.5px] text-[var(--text-tertiary)] -mt-0.5 hidden sm:block">
          {{ $t('config.subtitle') }}
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <Badge v-if="store.dirty" tone="warning">
          {{ $t('config.unsaved') }}
        </Badge>
        <Badge
          v-if="store.status"
          :tone="store.status.modelsValid && store.status.settingsValid ? 'success' : 'warning'"
        >
          {{
            store.status.modelsValid && store.status.settingsValid
              ? $t('config.valid')
              : $t('config.invalid')
          }}
        </Badge>
        <IconButton :label="$t('config.format')" @click="formatJson">
          <AlignLeft class="size-3.5" :stroke-width="1.75" />
        </IconButton>
        <IconButton :label="$t('config.reveal')" :disabled="!store.raw?.path" @click="revealFile">
          <FolderOpen class="size-3.5" :stroke-width="1.75" />
        </IconButton>
        <IconButton :label="$t('config.reload')" @click="reload">
          <RefreshCw class="size-3.5" :stroke-width="1.75" />
        </IconButton>
        <Button
          variant="primary"
          size="sm"
          :disabled="!store.dirty"
          :loading="store.saving"
          @click="save"
        >
          <Save class="size-3.5" :stroke-width="1.75" />
          {{ $t('common.save') }}
        </Button>
      </div>
    </header>

    <!-- File selector strip — a tab-like control, not Tabs components, just two
         underlined buttons. -->
    <div
      class="flex shrink-0 items-center gap-1 px-5 h-[36px] border-b border-[var(--border-subtle)]"
    >
      <button
        v-for="file in ['models', 'settings'] as const"
        :key="file"
        type="button"
        class="relative h-full px-2 text-[12.5px] transition-colors"
        :class="
          store.file === file
            ? 'text-[var(--text-primary)] font-medium'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
        "
        @click="switchFile(file)"
      >
        {{ file }}.json
        <span
          v-if="store.file === file"
          class="pointer-events-none absolute inset-x-0 bottom-0 h-[1.5px] bg-[var(--accent)]"
        />
      </button>
      <div class="ml-auto">
        <IconButton :label="$t('config.reset')" :disabled="!store.dirty" @click="resetDraft">
          <RotateCcw class="size-3.5" :stroke-width="1.75" />
        </IconButton>
      </div>
    </div>

    <!-- Path + (optionally) error, then editor fills the rest. -->
    <div class="flex-1 min-h-0 flex flex-col">
      <div class="px-5 py-2 space-y-1">
        <p
          v-if="store.raw"
          class="truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
          :title="store.raw.path"
        >
          {{ store.raw.path }}
        </p>
        <div
          v-if="store.error"
          class="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--error)]/30 bg-[var(--error-tint)] px-2.5 py-1.5 text-[11.5px] text-[var(--error)]"
        >
          <Circle class="size-2 shrink-0 fill-current text-[var(--error)]" :stroke-width="0" />
          {{ store.error }}
        </div>
      </div>
      <div
        ref="host"
        class="min-h-0 flex-1 overflow-hidden rounded-t-[var(--radius-md)] border border-[var(--border-subtle)] border-b-0 mx-5 mb-5"
      />
    </div>
  </div>
</template>
