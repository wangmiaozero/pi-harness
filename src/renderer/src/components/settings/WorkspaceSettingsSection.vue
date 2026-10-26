<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppSettings } from '@shared/ipc/api-types'
import Select from '@renderer/components/ui/Select.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import SessionCleanupSection from '@renderer/components/settings/SessionCleanupSection.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const draft = inject(SETTINGS_DRAFT_KEY)!

const { t } = useI18n()

const toolPresetOptions = computed(() => [
  { value: 'none', label: t('workspace.presetNone') },
  { value: 'read-only', label: t('workspace.presetReadOnly') },
  { value: 'default', label: t('workspace.presetDefault') },
  { value: 'full', label: t('workspace.presetFull') }
])

const permissionModeOptions = computed(() => [
  { value: 'ask', label: t('workspace.permissionAsk') },
  { value: 'accept-edits', label: t('workspace.permissionAcceptEdits') },
  { value: 'auto', label: t('workspace.permissionAuto') }
])

const agentModeOptions = computed(() => [
  { value: 'agent', label: t('workspace.modeAgent') },
  { value: 'plan', label: t('workspace.modePlan') },
  { value: 'goal', label: t('workspace.modeGoal') }
])

function onPresetChange(value: string): void {
  draft.value.defaultToolPreset = value as AppSettings['defaultToolPreset']
}

function onPermissionModeChange(value: string): void {
  draft.value.defaultPermissionMode = value as AppSettings['defaultPermissionMode']
}

function onAgentModeChange(value: string): void {
  draft.value.defaultAgentMode = value as AppSettings['defaultAgentMode']
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
      <Select
        :model-value="draft.defaultPermissionMode"
        :label="$t('agentSettings.defaultPermissionMode')"
        :options="permissionModeOptions"
        layout="row"
        @update:model-value="onPermissionModeChange"
      />
      <Select
        :model-value="draft.defaultAgentMode"
        :label="$t('agentSettings.defaultAgentMode')"
        :options="agentModeOptions"
        layout="row"
        @update:model-value="onAgentModeChange"
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
  <SessionCleanupSection />
</template>
