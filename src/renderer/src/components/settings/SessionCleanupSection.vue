<script setup lang="ts">
/**
 * Settings → Workspace → Session cleanup.
 *
 * Two-step confirmation happens entirely in the Renderer; Main only accepts
 * an execute request backed by a preview token it issued for this scan.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ScanSearch, Trash2 } from '@lucide/vue'
import Button from '@renderer/components/ui/Button.vue'
import Select from '@renderer/components/ui/Select.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { callApi, getApi } from '@renderer/composables/useApi'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { formatBytes } from '@renderer/utils/format'
import type {
  SessionCleanupPreview,
  SessionCleanupResult,
  SessionCleanupScope
} from '@shared/ipc/api-types'

const { t } = useI18n()
const sessions = useSessionStore()
const workspace = useWorkspaceStore()

const scope = ref<SessionCleanupScope>('current-project')
const keepPinned = ref(true)
const scanning = ref(false)
const executing = ref(false)
const preview = ref<SessionCleanupPreview | null>(null)
const result = ref<SessionCleanupResult | null>(null)

const scopeOptions = computed(() => {
  const current = sessions.projects.find((p) => p.projectKey === sessions.currentProjectKey)
  return [
    {
      value: 'current-project',
      label: t('settings.sessionCleanup.scopeCurrentProject', {
        project: current?.name ?? current?.projectRoot ?? t('settings.sessionCleanup.noProject')
      }),
      disabled: !current
    },
    { value: 'older-30d', label: t('settings.sessionCleanup.scopeOlder30') },
    { value: 'older-90d', label: t('settings.sessionCleanup.scopeOlder90') },
    { value: 'all', label: t('settings.sessionCleanup.scopeAll') }
  ]
})

function onScopeChange(value: string): void {
  scope.value = value as SessionCleanupScope
  preview.value = null
  result.value = null
}

function onKeepPinnedChange(value: boolean): void {
  keepPinned.value = value
  preview.value = null
  result.value = null
}

async function scan(): Promise<void> {
  scanning.value = true
  result.value = null
  try {
    preview.value = await callApi(() =>
      getApi().sessions.previewCleanup({
        scope: scope.value,
        ...(scope.value === 'current-project' && sessions.currentProjectKey
          ? { projectKey: sessions.currentProjectKey }
          : {}),
        keepPinned: keepPinned.value,
        pinnedSessionIds: keepPinned.value ? [...workspace.pinnedSessionIds] : []
      })
    )
  } catch (e) {
    preview.value = null
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    scanning.value = false
  }
}

async function cleanup(): Promise<void> {
  const current = preview.value
  if (!current || executing.value || current.candidates.length === 0) return

  // First confirmation: scope and real, measured disk impact.
  const first = await askConfirm({
    title: t('settings.sessionCleanup.confirmFirstTitle'),
    description: t('settings.sessionCleanup.confirmFirstBody', {
      count: current.candidates.length,
      size: formatBytes(current.totalBytes)
    }),
    confirmLabel: t('settings.sessionCleanup.continueLabel'),
    cancelLabel: t('common.cancel'),
    tone: 'danger'
  })
  if (!first) return

  // Second confirmation: permanence warning. Esc / close / cancel all abort.
  const second = await askConfirm({
    title: t('settings.sessionCleanup.confirmSecondTitle'),
    description: t('settings.sessionCleanup.confirmSecondBody'),
    confirmLabel: t('settings.sessionCleanup.permanentlyDelete'),
    cancelLabel: t('common.cancel'),
    tone: 'danger'
  })
  if (!second) return

  executing.value = true
  try {
    const outcome = await callApi(() => getApi().sessions.executeCleanup(current.previewToken))
    result.value = outcome
    preview.value = null
    // Drop every Renderer-side trace immediately: bindings, pins, tabs,
    // composer caches — then refresh so the sidebar updates without restart.
    for (const id of outcome.deletedSessionIds) workspace.forgetSession(id)
    await sessions.refresh(true)
    workspace.pruneUnavailableSessionTabs()
    if (outcome.failed > 0) toast.warning(t('settings.sessionCleanup.partialFailure'))
    else toast.success(t('settings.sessionCleanup.done'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    executing.value = false
  }
}
</script>

<template>
  <InspectorSection
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <template #title>{{ $t('settings.sessionCleanup.title') }}</template>
    <div class="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
      <p class="px-4 pt-3 text-[11.5px] leading-[16px] text-[var(--text-tertiary)]">
        {{ $t('settings.sessionCleanup.hint') }}
      </p>
      <div class="px-4 py-3">
        <Select
          :model-value="scope"
          :label="$t('settings.sessionCleanup.scope')"
          :options="scopeOptions"
          :disabled="scanning || executing"
          layout="row"
          @update:model-value="onScopeChange"
        />
      </div>
      <PropertyRow :label="$t('settings.sessionCleanup.keepPinned')">
        <div class="flex items-center justify-end">
          <Switch
            :model-value="keepPinned"
            :disabled="scanning || executing"
            :label="$t('settings.sessionCleanup.keepPinned')"
            @update:model-value="onKeepPinnedChange"
          />
        </div>
      </PropertyRow>
      <div class="flex items-center justify-end gap-2 px-4 py-3">
        <Button variant="secondary" size="sm" :disabled="scanning || executing" data-testid="session-cleanup-scan" @click="scan">
          <ScanSearch class="h-3.5 w-3.5" />
          {{
            scanning
              ? $t('settings.sessionCleanup.scanning')
              : $t('settings.sessionCleanup.scan')
          }}
        </Button>
        <Button
          variant="danger"
          size="sm"
          :disabled="!preview || preview.candidates.length === 0 || executing"
          data-testid="session-cleanup-execute"
          @click="cleanup"
        >
          <Trash2 class="h-3.5 w-3.5" />
          {{ executing
             ? $t('settings.sessionCleanup.running')
             : $t('settings.sessionCleanup.cleanupButton') }}
        </Button>
      </div>

      <div v-if="preview" class="space-y-1.5 px-4 py-3" data-testid="session-cleanup-preview">
        <p class="text-[11.5px] font-medium text-[var(--text-secondary)]">
          {{ $t('settings.sessionCleanup.scanResult', { count: preview.candidates.length }) }}
        </p>
        <p class="text-[11.5px] text-[var(--text-tertiary)]">
          {{ $t('settings.sessionCleanup.statSize', { size: formatBytes(preview.totalBytes) }) }}
          ·
          {{ $t('settings.sessionCleanup.statProjects', { count: preview.affectedProjects }) }}
          ·
          {{ $t('settings.sessionCleanup.statRunning', { count: preview.excludedRunning }) }}
          <template v-if="preview.excludedPinned > 0">
            ·
            {{ $t('settings.sessionCleanup.statPinned', { count: preview.excludedPinned }) }}
          </template>
        </p>
      </div>

      <div v-if="executing" class="px-4 py-3 text-[11.5px] text-[var(--text-secondary)]">
        {{ $t('settings.sessionCleanup.runningHint') }}
      </div>

      <div v-if="result" class="space-y-1.5 px-4 py-3" data-testid="session-cleanup-result">
        <p class="text-[11.5px] font-medium text-[var(--text-secondary)]">
          {{ $t('settings.sessionCleanup.resultTitle') }}
        </p>
        <p class="text-[11.5px] text-[var(--text-tertiary)]">
          {{ $t('settings.sessionCleanup.resultDeleted', { count: result.deleted }) }}
          ·
          {{ $t('settings.sessionCleanup.resultFreed', { size: formatBytes(result.freedBytes) }) }}
          <template v-if="result.failed > 0">
            ·
            <span class="text-[var(--warning)]">
              {{ $t('settings.sessionCleanup.resultFailed', { count: result.failed }) }}
            </span>
          </template>
          <template v-if="result.skippedRunning > 0">
            ·
            {{ $t('settings.sessionCleanup.resultSkippedRunning', { count: result.skippedRunning }) }}
          </template>
          <template v-if="result.skippedChanged > 0">
            ·
            {{ $t('settings.sessionCleanup.resultSkippedChanged', { count: result.skippedChanged }) }}
          </template>
        </p>
      </div>
    </div>
  </InspectorSection>
</template>
