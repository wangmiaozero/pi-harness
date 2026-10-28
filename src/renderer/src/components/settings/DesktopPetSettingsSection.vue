<script setup lang="ts">
import { computed, inject } from 'vue'
import Input from '@renderer/components/ui/Input.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'
import PetPackManager from '@renderer/components/settings/PetPackManager.vue'

const draft = inject(SETTINGS_DRAFT_KEY)!

const pet = computed(() => draft.value.desktopPet)

const sizeStr = computed({
  get: () => String(pet.value.size),
  set: (v: string) => {
    const n = parseInt(v, 10)
    pet.value.size = Number.isFinite(n) ? Math.min(320, Math.max(96, n)) : 160
  }
})

const opacityPercentStr = computed({
  get: () => String(Math.round(pet.value.opacity * 100)),
  set: (v: string) => {
    const n = parseInt(v, 10)
    pet.value.opacity = Number.isFinite(n) ? Math.min(100, Math.max(30, n)) / 100 : 1
  }
})

const bubbleOpacityPercentStr = computed({
  get: () => String(Math.round(pet.value.bubbleOpacity * 100)),
  set: (v: string) => {
    const n = parseInt(v, 10)
    pet.value.bubbleOpacity = Number.isFinite(n) ? Math.min(100, Math.max(30, n)) / 100 : 1
  }
})

const bubbleTimeoutStr = computed({
  get: () => String(pet.value.bubbleTimeoutSeconds),
  set: (v: string) => {
    const n = parseInt(v, 10)
    pet.value.bubbleTimeoutSeconds = Number.isFinite(n) ? Math.min(60, Math.max(0, n)) : 6
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
        <Input v-model="sizeStr" type="number" min="96" max="320" class="w-20" />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetOpacity')">
        <Input v-model="opacityPercentStr" type="number" min="30" max="100" class="w-20" />
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
        <Input
          v-model="bubbleTimeoutStr"
          type="number"
          min="0"
          max="60"
          class="w-20"
          :disabled="!pet.bubbleEnabled"
        />
      </PropertyRow>
      <PropertyRow :label="$t('settings.desktopPetBubbleOpacity')">
        <Input
          v-model="bubbleOpacityPercentStr"
          type="number"
          min="30"
          max="100"
          class="w-20"
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
