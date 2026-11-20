<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppSettings } from '@shared/ipc/api-types'
import {
  SMART_COMPACTION_MAX_TOKENS,
  SMART_COMPACTION_RATIOS
} from '@shared/workspace/smart-compaction'
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

const ratioOptions = computed(() =>
  SMART_COMPACTION_RATIOS.map((ratio) => ({
    value: String(ratio),
    label: `${Math.round(ratio * 100)}%`
  }))
)

const maxTokenOptions = computed(() =>
  SMART_COMPACTION_MAX_TOKENS.map((tokens) => ({
    value: String(tokens),
    label: tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${tokens / 1000}K`
  }))
)

function onPresetChange(value: string): void {
  draft.value.defaultToolPreset = value as AppSettings['defaultToolPreset']
}

function onPermissionModeChange(value: string): void {
  draft.value.defaultPermissionMode = value as AppSettings['defaultPermissionMode']
}

function onAgentModeChange(value: string): void {
  draft.value.defaultAgentMode = value as AppSettings['defaultAgentMode']
}

function onSmartRatioChange(value: string): void {
  draft.value.smartCompaction = {
    ...draft.value.smartCompaction,
    ratio: Number(value) as AppSettings['smartCompaction']['ratio']
  }
}

function onSmartMaxTokensChange(value: string): void {
  draft.value.smartCompaction = {
    ...draft.value.smartCompaction,
    maxTokens: Number(value) as AppSettings['smartCompaction']['maxTokens']
  }
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
      <PropertyRow :label="$t('settings.smartCompaction')">
        <div class="flex items-center justify-end">
          <Switch
            v-model="draft.smartCompaction.enabled"
            :label="$t('settings.smartCompaction')"
          />
        </div>
      </PropertyRow>
      <Select
        v-if="draft.smartCompaction.enabled"
        :model-value="String(draft.smartCompaction.ratio)"
        :label="$t('settings.smartCompactionRatio')"
        :options="ratioOptions"
        layout="row"
        @update:model-value="onSmartRatioChange"
      />
      <Select
        v-if="draft.smartCompaction.enabled"
        :model-value="String(draft.smartCompaction.maxTokens)"
        :label="$t('settings.smartCompactionMaxTokens')"
        :options="maxTokenOptions"
        layout="row"
        @update:model-value="onSmartMaxTokensChange"
      />
    </div>
  </InspectorSection>
</template>
