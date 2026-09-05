<script setup lang="ts">
import { inject } from 'vue'
import Switch from '@renderer/components/ui/Switch.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import PetDebug from '@renderer/components/pet/PetDebug.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const draft = inject(SETTINGS_DRAFT_KEY)!
</script>

<template>
  <InspectorSection
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <PropertyRow :label="$t('settings.developerMode')">
      <div class="flex items-center justify-end">
        <Switch v-model="draft.developerMode" :label="$t('settings.developerMode')" />
      </div>
    </PropertyRow>
    <PropertyRow :label="$t('settings.mockMode')">
      <div class="flex items-center justify-end">
        <Switch v-model="draft.mockMode" :label="$t('settings.mockMode')" />
      </div>
    </PropertyRow>
    <PetDebug v-if="draft.developerMode" :style="draft.mascotStyle" />
  </InspectorSection>
</template>
