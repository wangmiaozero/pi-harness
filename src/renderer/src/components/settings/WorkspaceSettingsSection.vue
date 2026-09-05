<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppSettings } from '@shared/ipc/api-types'
import Select from '@renderer/components/ui/Select.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const draft = inject(SETTINGS_DRAFT_KEY)!

const { t } = useI18n()

const toolPresetOptions = computed(() => [
  { value: 'none', label: t('workspace.presetNone') },
  { value: 'read-only', label: t('workspace.presetReadOnly') },
  { value: 'default', label: t('workspace.presetDefault') },
  { value: 'full', label: t('workspace.presetFull') }
])

function onPresetChange(value: string): void {
  draft.value.defaultToolPreset = value as AppSettings['defaultToolPreset']
}
</script>

<template>
  <InspectorSection
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <div class="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
      <Select
        :model-value="draft.defaultToolPreset"
        :label="$t('settings.defaultToolPreset')"
        :options="toolPresetOptions"
        layout="row"
        @update:model-value="onPresetChange"
      />
      <PropertyRow :label="$t('settings.restoreTabs')">
        <div class="flex items-center justify-end">
          <Switch v-model="draft.restoreTabs" :label="$t('settings.restoreTabs')" />
        </div>
      </PropertyRow>
      <PropertyRow :label="$t('settings.autoOpenLastProject')">
        <div class="flex items-center justify-end">
          <Switch v-model="draft.autoOpenLastProject" :label="$t('settings.autoOpenLastProject')" />
        </div>
      </PropertyRow>
    </div>
  </InspectorSection>
</template>
