<script setup lang="ts">
import { computed, inject } from 'vue'
import RangeSlider from '@renderer/components/ui/RangeSlider.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'
import PetPackManager from '@renderer/components/settings/PetPackManager.vue'

const draft = inject(SETTINGS_DRAFT_KEY)!

const pet = computed(() => draft.value.desktopPet)

const opacityPercent = computed({
  get: () => Math.round(pet.value.opacity * 100),
  set: (value: number) => {
    pet.value.opacity = value / 100
  }
})
const bubbleOpacityPercent = computed({
  get: () => Math.round(pet.value.bubbleOpacity * 100),
  set: (value: number) => {
    pet.value.bubbleOpacity = value / 100
  }
})
</script>

<template>
  <section class="space-y-4" data-testid="desktop-pet-section">
    <div
      class="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
    >
      <PropertyRow :label="$t('settings.desktopPetEnabled')">
        <Switch v-model="pet.enabled" :label="$t('settings.desktopPetEnabled')" />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetAgentSync')">
        <Switch v-model="pet.agentSync" :label="$t('settings.desktopPetAgentSync')" />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetAlwaysOnTop')">
        <Switch v-model="pet.alwaysOnTop" :label="$t('settings.desktopPetAlwaysOnTop')" />
      </PropertyRow>
    </div>

    <div class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-3">
      <p class="mb-2 px-1 text-[12px] font-medium">{{ $t('settings.petPackManager') }}</p>
      <PetPackManager v-model="pet.activePackId" />
    </div>

    <div
      class="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
    >
      <PropertyRow :label="$t('settings.desktopPetSize')">
        <RangeSlider
          v-model="pet.size"
          :min="96"
          :max="320"
          :label="$t('settings.desktopPetSize')"
          :value-text="`${pet.size} px`"
        />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetOpacity')">
        <RangeSlider
          v-model="opacityPercent"
          :min="30"
          :max="100"
          :label="$t('settings.desktopPetOpacity')"
          :value-text="`${opacityPercent}%`"
        />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetIdleVariants')">
        <Switch v-model="pet.idleVariants" :label="$t('settings.desktopPetIdleVariants')" />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetPhysics')">
        <Switch v-model="pet.physics" :label="$t('settings.desktopPetPhysics')" />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetReducedMotion')">
        <Switch v-model="pet.reducedMotion" :label="$t('settings.desktopPetReducedMotion')" />
      </PropertyRow>
    </div>

    <div
      class="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
    >
      <PropertyRow :label="$t('settings.desktopPetBubble')">
        <Switch v-model="pet.bubbleEnabled" :label="$t('settings.desktopPetBubble')" />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetBubbleTimeout')">
        <RangeSlider
          v-model="pet.bubbleTimeoutSeconds"
          :min="0"
          :max="60"
          :label="$t('settings.desktopPetBubbleTimeout')"
          :disabled="!pet.bubbleEnabled"
        />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetBubbleOpacity')">
        <RangeSlider
          v-model="bubbleOpacityPercent"
          :min="30"
          :max="100"
          :label="$t('settings.desktopPetBubbleOpacity')"
          :value-text="`${bubbleOpacityPercent}%`"
          :disabled="!pet.bubbleEnabled"
        />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetShowAgentCount')">
        <Switch
          v-model="pet.showAgentCount"
          :label="$t('settings.desktopPetShowAgentCount')"
          :disabled="!pet.bubbleEnabled"
        />
      </PropertyRow>
    </div>
  </section>
</template>
