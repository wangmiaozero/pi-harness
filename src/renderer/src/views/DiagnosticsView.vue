<script setup lang="ts">
import { onMounted, ref, watch, nextTick } from 'vue'
import { RefreshCw, Copy, Download, Activity } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import Button from '@renderer/components/ui/Button.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import { graphiteEditorTheme, graphiteSyntaxHighlighting } from '@renderer/styles/codemirror'
import { useDiagnosticsStore } from '@renderer/stores/diagnostics'
import { useI18n } from 'vue-i18n'

const store = useDiagnosticsStore()
const { t } = useI18n()

/* CodeMirror viewer for the raw report. We keep it tiny — 1 instance, mounted
 * only when the report is loaded. */
const rawHost = ref<HTMLElement | null>(null)
let rawView: EditorView | null = null

function mountRawView(doc: string) {
  rawView?.destroy()
  if (!rawHost.value) return
  rawView = new EditorView({
    parent: rawHost.value,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        json(),
        graphiteEditorTheme,
        graphiteSyntaxHighlighting,
        EditorView.editable.of(false)
      ]
    })
  })
}

watch(
  () => store.report,
  async (r) => {
    if (r) {
      await nextTick()
      mountRawView(JSON.stringify(r, null, 2))
    } else {
      rawView?.destroy()
      rawView = null
    }
  }
)

async function refresh() {
  await store.fetch()
}

async function copyReport() {
  try {
    await store.copyToClipboard()
    toast.success(t('diagnostics.copied'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('diagnostics.copyFailed'))
  }
}

async function exportReport() {
  try {
    const path = await store.exportReport()
    toast.success(t('diagnostics.exported'), { description: path })
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('diagnostics.exportFailed'))
  }
}

onMounted(() => {
  void store.fetch()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header
      class="flex shrink-0 items-center justify-between gap-3 px-5 h-[var(--height-page-header)] border-b border-[var(--border-subtle)]"
    >
      <div class="min-w-0">
        <h1 class="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          {{ $t('diagnostics.title') }}
        </h1>
        <p class="text-[11.5px] text-[var(--text-tertiary)] -mt-0.5">
          {{ $t('diagnostics.subtitle') }}
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" :loading="store.loading" @click="refresh">
          <RefreshCw class="size-3.5" :stroke-width="1.75" />
        </Button>
        <Button variant="ghost" size="sm" :disabled="!store.report" @click="copyReport">
          <Copy class="size-3.5" :stroke-width="1.75" />
          {{ $t('common.copy') }}
        </Button>
        <Button variant="secondary" size="sm" :disabled="!store.report" @click="exportReport">
          <Download class="size-3.5" :stroke-width="1.75" />
          {{ $t('common.export') }}
        </Button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div
        v-if="store.loading && !store.report"
        class="py-12 text-center text-[11.5px] text-[var(--text-tertiary)]"
      >
        {{ $t('common.loading') }}
      </div>

      <EmptyState
        v-else-if="!store.report"
        :title="$t('diagnostics.empty')"
        :description="$t('diagnostics.emptyHint')"
        :icon="Activity"
      >
        <Button variant="primary" size="sm" class="mt-3" :loading="store.loading" @click="refresh">
          {{ $t('diagnostics.refresh') }}
        </Button>
      </EmptyState>

      <template v-else>
        <!-- Status strip: App / Pi / Config in one Surface, divided by hairlines. -->
        <div class="px-5 pt-4">
          <div
            class="grid grid-cols-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-x divide-[var(--border-subtle)]"
          >
            <div class="px-4 py-3">
              <p
                class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
              >
                {{ $t('diagnostics.application') }}
              </p>
              <p class="mt-0.5 text-[13px] font-semibold text-[var(--text-primary)]">
                Pi-Switch {{ store.report.app.version }}
              </p>
              <p class="text-[10.5px] text-[var(--text-tertiary)]">
                Electron {{ store.report.app.electron }}
              </p>
            </div>
            <div class="px-4 py-3">
              <p
                class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
              >
                {{ $t('diagnostics.piCli') }}
              </p>
              <div class="mt-0.5 flex items-center gap-2">
                <Badge :tone="store.report.pi.installed ? 'success' : 'error'">
                  {{
                    store.report.pi.installed ? $t('common.installed') : $t('diagnostics.missing')
                  }}
                </Badge>
                <span
                  v-if="store.report.pi.version"
                  class="font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-secondary)]"
                >
                  v{{ store.report.pi.version }}
                </span>
              </div>
            </div>
            <div class="px-4 py-3">
              <p
                class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
              >
                {{ $t('diagnostics.configuration') }}
              </p>
              <div class="mt-0.5 flex items-center gap-2">
                <Badge
                  :tone="
                    store.report.config.modelsValid && store.report.config.settingsValid
                      ? 'success'
                      : 'warning'
                  "
                >
                  {{
                    store.report.config.modelsValid && store.report.config.settingsValid
                      ? $t('common.valid')
                      : $t('diagnostics.issues')
                  }}
                </Badge>
                <span class="text-[10.5px] text-[var(--text-tertiary)]">
                  {{ store.report.config.modelsPath ? $t('diagnostics.writable') : '—' }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Property table (Inspector-style) -->
        <div class="px-5 pt-4 pb-2 space-y-4">
          <InspectorSection>
            <template #title>{{ $t('diagnostics.environment') }}</template>
            <PropertyRow :label="$t('diagnostics.platform')" mono>
              {{ store.report.system.platform }} / {{ store.report.system.arch }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.piCli')" mono>
              {{ store.report.pi.cliPath ?? '—' }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.configPath')" mono>
              {{ store.report.config.modelsPath }}
            </PropertyRow>
            <PropertyRow label="PATH" mono>
              {{ store.report.system.pathSummary }}
            </PropertyRow>
            <PropertyRow v-if="store.report.config.lastError" :label="$t('diagnostics.lastError')">
              <span class="text-[var(--error)]">{{ store.report.config.lastError }}</span>
            </PropertyRow>
          </InspectorSection>
        </div>

        <!-- Raw report (CodeMirror, full-width) -->
        <div class="px-5 pb-6">
          <div class="flex items-center justify-between h-[30px]">
            <h3
              class="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
            >
              {{ $t('diagnostics.rawReport') }}
            </h3>
            <div class="flex items-center gap-1">
              <IconButton :label="$t('common.copy')" @click="copyReport">
                <Copy class="size-3.5" :stroke-width="1.75" />
              </IconButton>
              <IconButton :label="$t('common.export')" @click="exportReport">
                <Download class="size-3.5" :stroke-width="1.75" />
              </IconButton>
            </div>
          </div>
          <div
            ref="rawHost"
            class="h-[280px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-workspace)]"
          />
        </div>
      </template>
    </div>
  </div>
</template>
