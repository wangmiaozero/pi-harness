<script setup lang="ts">
import { onMounted, ref, watch, nextTick } from 'vue'
import { RefreshCw, Copy, Download, Activity, Wrench } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import PageHeader from '@renderer/components/common/PageHeader.vue'
import Button from '@renderer/components/ui/Button.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import { graphiteEditorTheme, graphiteSyntaxHighlighting } from '@renderer/styles/codemirror'
import { useDiagnosticsStore } from '@renderer/stores/diagnostics'
import { useI18n } from 'vue-i18n'
import { callApi, getApi } from '@renderer/composables/useApi'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { usePiStore } from '@renderer/stores/pi'
import EnvironmentTaskProgress from '@renderer/components/environment/EnvironmentTaskProgress.vue'
import { askConfirm } from '@renderer/composables/useConfirmDialog'

const store = useDiagnosticsStore()
const { t } = useI18n()
const workspace = useWorkspaceStore()
const pi = usePiStore()
const repairingPermissions = ref(false)

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

async function repairPermissions() {
  repairingPermissions.value = true
  try {
    const reports = await callApi(() => getApi().skills.repairPermissions(workspace.currentCwd))
    const remaining = reports.filter((entry) => entry.problem).length
    if (remaining) toast.warning(t('diagnostics.permissionsRemain', { count: remaining }))
    else toast.success(t('diagnostics.permissionsRepaired'))
    await refresh()
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('diagnostics.permissionsRepairFailed'))
  } finally {
    repairingPermissions.value = false
  }
}

async function repairEnvironment() {
  const confirmed = await askConfirm({
    title: t('overview.bootstrapConfirmTitle'),
    description: t('overview.bootstrapConfirm'),
    confirmLabel: t('overview.bootstrapAction'),
    tone: 'primary'
  })
  if (!confirmed) return
  try {
    const result = await pi.bootstrap()
    toast.success(t('overview.installOk'), { description: result.message })
    await refresh()
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('common.failed'))
  }
}

onMounted(() => {
  void store.fetch()
})

watch(
  () => pi.environment,
  () => {
    if (store.report) void refresh()
  }
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <PageHeader>
      <div class="flex min-w-0 flex-col justify-center self-stretch">
        <h1
          class="text-[15px] font-semibold leading-[18px] tracking-tight text-[var(--text-primary)]"
        >
          {{ $t('diagnostics.title') }}
        </h1>
        <p class="mt-[3px] text-[11.5px] leading-[14px] text-[var(--text-tertiary)]">
          {{ $t('diagnostics.subtitle') }}
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <Button
          v-if="store.report?.environment.state !== 'ready'"
          variant="primary"
          size="sm"
          :loading="pi.mutating"
          :disabled="pi.mutating"
          @click="repairEnvironment"
        >
          <Wrench class="size-3.5" />
          {{ $t('diagnostics.repairEnvironment') }}
        </Button>
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
    </PageHeader>

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
            class="grid grid-cols-4 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-x divide-[var(--border-subtle)]"
          >
            <div class="px-4 py-3">
              <p
                class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
              >
                {{ $t('diagnostics.application') }}
              </p>
              <p class="mt-0.5 text-[13px] font-semibold text-[var(--text-primary)]">
                Pi-Harness {{ store.report.app.version }}
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
            <div class="px-4 py-3">
              <p
                class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
              >
                {{ $t('diagnostics.packages') }}
              </p>
              <div class="mt-0.5 flex items-center gap-2">
                <Badge :tone="store.report.packages.startupRisk ? 'error' : 'success'">
                  {{
                    store.report.packages.startupRisk
                      ? $t('diagnostics.startupRisk')
                      : $t('diagnostics.healthy')
                  }}
                </Badge>
                <span class="text-[10.5px] text-[var(--text-tertiary)]">
                  {{ store.report.packages.healthyCount }}/{{ store.report.packages.registryCount }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="pi.installTask" class="px-5 pt-4">
          <EnvironmentTaskProgress :task="pi.installTask" @cancel="pi.cancelInstall" />
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
            <PropertyRow label="Node.js" mono>
              {{ store.report.environment.nodeRuntime.nodeVersion ?? '—' }} ·
              {{ store.report.environment.nodeRuntime.nodePath ?? '—' }}
            </PropertyRow>
            <PropertyRow label="npm" mono>
              {{ store.report.environment.nodeRuntime.npmVersion ?? '—' }} ·
              {{ store.report.environment.nodeRuntime.npmPath ?? '—' }}
            </PropertyRow>
            <PropertyRow label="npm prefix" mono>
              {{ store.report.environment.nodeRuntime.npmPrefix ?? '—' }}
              ·
              {{
                store.report.environment.nodeRuntime.npmPrefixWritable === true
                  ? $t('diagnostics.writable')
                  : store.report.environment.nodeRuntime.npmPrefixWritable === false
                    ? $t('diagnostics.notWritable')
                    : '—'
              }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.configPath')" mono>
              {{ store.report.config.modelsPath }}
            </PropertyRow>
            <PropertyRow label="PATH" mono>
              {{ store.report.system.pathSummary }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.sessionRoot')" mono>
              {{ store.report.workspace.sessionRoot || '—' }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.sessionCount')">
              {{ store.report.workspace.sessionCount }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.runningSessions')">
              {{ store.report.workspace.runningSessions.join(', ') || '—' }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.piSdk')">
              {{
                store.report.workspace.piSdkLoaded ? $t('common.installed') : $t('common.notFound')
              }}
            </PropertyRow>
            <PropertyRow v-if="store.report.config.lastError" :label="$t('diagnostics.lastError')">
              <span class="text-[var(--error)]">{{ store.report.config.lastError }}</span>
            </PropertyRow>
          </InspectorSection>
          <InspectorSection>
            <template #title>
              <span class="flex items-center justify-between gap-3">
                <span>{{ $t('diagnostics.packageHealth') }}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  :loading="repairingPermissions"
                  @click="repairPermissions"
                >
                  <Wrench class="size-3.5" />
                  {{ $t('diagnostics.repairPermissions') }}
                </Button>
              </span>
            </template>
            <PropertyRow :label="$t('diagnostics.registeredPackages')">
              {{ store.report.packages.registryCount }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.healthyPackages')">
              {{ store.report.packages.healthyCount }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.missingPackages')">
              {{ store.report.packages.missingCount }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.orphanedPackages')">
              {{ store.report.packages.orphanedCount }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.corruptedPackages')">
              {{ store.report.packages.corruptedCount }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.permissionErrors')">
              {{ store.report.packages.permissionErrorCount }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.packageSkills')">
              {{ store.report.packages.skillsCount }}
            </PropertyRow>
            <PropertyRow :label="$t('diagnostics.registryPaths')" mono>
              {{ store.report.packages.registryPaths.join(', ') || '—' }}
            </PropertyRow>
            <PropertyRow
              v-for="permission in store.report.packages.permissions.filter(
                (entry) => entry.problem
              )"
              :key="permission.path"
              :label="$t('diagnostics.permissionProblem')"
              mono
            >
              <!-- prettier-ignore -->
              <span class="text-[var(--error)]">{{ permission.path }} · {{ permission.problem }}</span>
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
