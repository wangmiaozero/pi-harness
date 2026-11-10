<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  DESKTOP_PET_SIZE_DEFAULT,
  DESKTOP_PET_SIZE_MIN,
  DESKTOP_PET_SIZE_MAX
} from '@shared/pet/desktop'
import RangeSlider from '@renderer/components/ui/RangeSlider.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'
import PetPackManager from '@renderer/components/settings/PetPackManager.vue'
import TibotPetSettings from '@renderer/components/settings/TibotPetSettings.vue'

const draft = inject(SETTINGS_DRAFT_KEY)!

const pet = computed(() => draft.value.desktopPet)
const petKnown = ref(false)
const petReady = ref(false)

function onPetReady(ready: boolean): void {
  petKnown.value = true
  petReady.value = ready
}
const sizePercent = computed({
  get: () => Math.round((pet.value.size / DESKTOP_PET_SIZE_DEFAULT) * 100),
  set: (value: number) => {
    pet.value.size = Math.round((value / 100) * DESKTOP_PET_SIZE_DEFAULT)
  }
})

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
  <section
    class="space-y-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
    data-testid="desktop-pet-section"
  >
    <p
      v-if="petKnown && !petReady"
      class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2 text-[12px] text-[var(--text-secondary)]"
    >
      {{ $t('settings.marketMissingPet') }}
      <RouterLink class="ml-1 underline" to="/settings/market">{{ $t('settings.marketOpen') }}</RouterLink>
    </p>
    <div v-if="petReady" data-testid="desktop-pet-group-basic">
      <h3 class="desktop-pet-group-title">{{ $t('settings.desktopPetGroupBasic') }}</h3>
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
    </div>

    <div>
      <h3 class="desktop-pet-group-title">{{ $t('settings.petPackManager') }}</h3>
      <div class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-3">
        <PetPackManager v-model="pet.activePackId" @ready="onPetReady" />
      </div>
    </div>

    <TibotPetSettings v-if="petReady" />

    <div v-if="petReady" data-testid="desktop-pet-group-appearance">
      <h3 class="desktop-pet-group-title">{{ $t('settings.desktopPetGroupAppearance') }}</h3>
    <div
      class="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
    >
      <PropertyRow :label="$t('settings.desktopPetSize')">
        <RangeSlider
          v-model="sizePercent"
          :min="Math.round((DESKTOP_PET_SIZE_MIN / DESKTOP_PET_SIZE_DEFAULT) * 100)"
          :max="Math.round((DESKTOP_PET_SIZE_MAX / DESKTOP_PET_SIZE_DEFAULT) * 100)"
          :label="$t('settings.desktopPetSize')"
          :value-text="`${sizePercent}%`"
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
    </div>

    <div v-if="petReady" data-testid="desktop-pet-group-bubble">
      <h3 class="desktop-pet-group-title">{{ $t('settings.desktopPetGroupBubble') }}</h3>
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
    </div>
  </section>
</template>

<style scoped>
.desktop-pet-group-title {
  margin: 0 0 8px 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
}
</style>
