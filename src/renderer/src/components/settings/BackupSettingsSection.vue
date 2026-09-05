<script setup lang="ts">
import { computed, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Archive, Eraser, FolderOpen, RotateCcw, Trash2 } from '@lucide/vue'
import Button from '@renderer/components/ui/Button.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { formatBytes, formatDateTime } from '@renderer/utils/format'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const draft = inject(SETTINGS_DRAFT_KEY)!

const { t, locale } = useI18n()
const store = useSettingsStore()

onMounted(() => {
  void store.fetchBackups()
})

const backupRetentionStr = computed({
  get: () => String(draft.value.backupRetention),
  set: (v: string) => {
    const n = parseInt(v, 10)
    draft.value.backupRetention = Number.isFinite(n) && n > 0 ? n : 20
  }
})

async function createBackup(): Promise<void> {
  try {
    await store.createBackup('manual')
    toast.success(t('settings.backupCreated'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function restoreBackup(id: string): Promise<void> {
  const ok = await askConfirm({
    title: t('settings.restoreTitle'),
    description: t('settings.restoreConfirm'),
    confirmLabel: t('settings.restoreAction'),
    tone: 'danger'
  })
  if (!ok) return
  try {
    await store.restoreBackup(id)
    toast.success(t('settings.backupRestored'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function deleteBackup(id: string): Promise<void> {
  const ok = await askConfirm({
    title: t('settings.deleteBackupTitle'),
    description: t('settings.deleteBackupConfirm'),
    confirmLabel: t('settings.deleteBackupAction'),
    tone: 'danger'
  })
  if (!ok) return
  try {
    await store.deleteBackup(id)
    toast.success(t('settings.backupDeleted'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function cleanupBackups(): Promise<void> {
  const retention = draft.value.backupRetention
  const deleteCount = Math.max(0, store.backups.length - retention)
  if (deleteCount === 0) {
    toast.info(t('settings.cleanupNone', { count: retention }))
    return
  }
  const ok = await askConfirm({
    title: t('settings.cleanupTitle'),
    description: t('settings.cleanupConfirm', { retention, count: deleteCount }),
    confirmLabel: t('settings.cleanupAction'),
    tone: 'danger'
  })
  if (!ok) return
  try {
    const result = await store.pruneBackups(retention)
    toast.success(
      t('settings.cleanupDone', {
        count: result.deleted,
        size: formatBytes(result.freedBytes)
      })
    )
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}
</script>

<template>
  <InspectorSection
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <PropertyRow :label="$t('settings.autoBackup')">
      <div class="flex items-center justify-end">
        <Switch v-model="draft.autoBackup" :label="$t('settings.autoBackup')" />
      </div>
    </PropertyRow>
    <PropertyRow :label="$t('settings.retention')">
      <input
        v-model="backupRetentionStr"
        type="number"
        min="1"
        step="1"
        :aria-label="$t('settings.retention')"
        class="h-[var(--height-input)] w-[88px] rounded-[var(--radius-sm)] border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 text-right text-[12px] tabular-nums text-[var(--text-primary)] shadow-[var(--control-shadow)] transition-[background-color,border-color,box-shadow] hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--control-bg-hover)] focus:outline-none focus:shadow-[var(--focus-ring)]"
      />
    </PropertyRow>
    <div
      class="px-3 py-2 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)]"
    >
      <Button variant="secondary" size="sm" @click="createBackup">
        <Archive class="size-3.5" :stroke-width="1.75" />
        {{ $t('settings.createBackup') }}
      </Button>
      <Button variant="secondary" size="sm" @click="cleanupBackups">
        <Eraser class="size-3.5" :stroke-width="1.75" />
        {{ $t('settings.cleanupBackups') }}
      </Button>
      <Button variant="ghost" size="sm" @click="store.openBackupFolder">
        <FolderOpen class="size-3.5" :stroke-width="1.75" />
        {{ $t('settings.openFolder') }}
      </Button>
    </div>
    <p class="px-3 pb-2 text-[10.5px] text-[var(--text-tertiary)]">
      {{ $t('settings.cleanupHint', { count: draft.backupRetention }) }}
    </p>
    <div class="border-t border-[var(--border-subtle)]">
      <div
        v-if="store.backupsLoading"
        class="px-3 py-3 text-[11.5px] text-[var(--text-tertiary)]"
      >
        {{ $t('settings.loadingBackups') }}
      </div>
      <div
        v-else-if="store.backups.length === 0"
        class="px-3 py-3 text-[11.5px] text-[var(--text-tertiary)]"
      >
        {{ $t('settings.noBackups') }}
      </div>
      <ul v-else class="divide-y divide-[var(--border-subtle)]">
        <li
          v-for="backup in store.backups"
          :key="backup.id"
          class="group flex items-center gap-3 px-3 py-1.5 hover:bg-[var(--bg-hover)]"
        >
          <div class="min-w-0 flex-1">
            <div
              class="truncate text-[12px] text-[var(--text-primary)]"
              :title="formatDateTime(backup.timestamp, locale === 'zh-CN' ? 'zh-CN' : 'en-US')"
            >
              {{ formatDateTime(backup.timestamp, locale === 'zh-CN' ? 'zh-CN' : 'en-US') }}
            </div>
            <div class="flex items-center gap-1.5 mt-0.5">
              <Badge tone="muted">{{ backup.reason }}</Badge>
              <span class="text-[10.5px] text-[var(--text-tertiary)] tabular-nums">
                {{ formatBytes(backup.sizeBytes) }}
              </span>
            </div>
          </div>
          <div
            class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          >
            <IconButton :label="$t('common.restore')" @click="restoreBackup(backup.id)">
              <RotateCcw class="size-3.5" :stroke-width="1.75" />
            </IconButton>
            <IconButton variant="danger" :label="$t('common.delete')" @click="deleteBackup(backup.id)">
              <Trash2 class="size-3.5" :stroke-width="1.75" />
            </IconButton>
          </div>
        </li>
      </ul>
    </div>
  </InspectorSection>
</template>
