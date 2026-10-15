<script setup lang="ts">
import RuntimeSettingsSection from './RuntimeSettingsSection.vue'
import { computed, inject } from 'vue'
import Input from '@renderer/components/ui/Input.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const draft = inject(SETTINGS_DRAFT_KEY)!

const manualConfigDir = computed({
  get: () => draft.value.manualConfigDir ?? '',
  set: (v: string) => {
    draft.value.manualConfigDir = v.trim() || null
  }
})
</script>

<template>
  <InspectorSection
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <div class="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
      <RuntimeSettingsSection />
      <Input
        v-model="manualConfigDir"
        :label="$t('settings.configDir')"
        :hint="$t('settings.configDirHint')"
        placeholder="~/.pi/agent"
        layout="row"
        mono
      />
    </div>
  </InspectorSection>
</template>
