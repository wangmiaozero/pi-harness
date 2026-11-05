<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  isTibotPackId,
  TIBOT_ACTIONS,
  TIBOT_COLORS,
  type TibotAction
} from '@shared/pet/tibot'
import RangeSlider from '@renderer/components/ui/RangeSlider.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const { t } = useI18n()
const draft = inject(SETTINGS_DRAFT_KEY)!
const pet = computed(() => draft.value.desktopPet)
const tibot = computed(() => pet.value.tibot)
const visible = computed(() => isTibotPackId(pet.value.activePackId))

const energyPercent = computed({
  get: () => Math.round(tibot.value.energy * 100),
  set: (value: number) => {
    tibot.value.energy = value / 100
  }
})
const lightPercent = computed({
  get: () => Math.round(tibot.value.light * 100),
  set: (value: number) => {
    tibot.value.light = value / 100
  }
})

const actionLabels = computed<Record<TibotAction, string>>(() => ({
  jump: t('settings.tibotActJump'),
  spin: t('settings.tibotActSpin'),
  dance: t('settings.tibotActDance'),
  surprise: t('settings.tibotActSurprise'),
  sleep: t('settings.tibotActSleep'),
  celebrate: t('settings.tibotActCelebrate'),
  wobble: t('settings.tibotActWobble'),
  dash: t('settings.tibotActDash'),
  wink: t('settings.tibotActWink')
}))

function setColor(color: string): void {
  tibot.value.color = color
}
function play(action: TibotAction): void {
  tibot.value.cue = { action, at: Date.now() }
}
</script>

<template>
  <div v-if="visible" class="space-y-4" data-testid="tibot-pet-settings">
    <div class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-3">
      <p class="mb-2 px-1 text-[12px] font-medium">{{ $t('settings.tibotColors') }}</p>
      <div class="flex flex-wrap gap-2 px-1">
        <button
          v-for="(color, index) in TIBOT_COLORS"
          :key="color"
          type="button"
          class="size-8 rounded-full border-2"
          :style="{ background: color }"
          :class="
            tibot.color === color
              ? 'border-[var(--text-primary)]'
              : 'border-white shadow-[0_0_0_1px_var(--border-subtle)]'
          "
          :aria-label="t('settings.tibotColor', { n: index + 1 })"
          :aria-pressed="tibot.color === color"
          @click="setColor(color)"
        />
      </div>
    </div>

    <div
      class="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
    >
      <p class="px-4 py-2 text-[12px] font-medium">{{ $t('settings.tibotMotion') }}</p>
      <PropertyRow :label="$t('settings.tibotEnergy')">
        <RangeSlider
          v-model="energyPercent"
          :min="0"
          :max="100"
          :label="$t('settings.tibotEnergy')"
          :value-text="`${energyPercent}%`"
        />
      </PropertyRow>
      <PropertyRow :label="$t('settings.tibotLight')">
        <RangeSlider
          v-model="lightPercent"
          :min="0"
          :max="100"
          :label="$t('settings.tibotLight')"
          :value-text="`${lightPercent}%`"
        />
      </PropertyRow>
      <PropertyRow :label="$t('settings.tibotTracking')">
        <Switch v-model="tibot.tracking" :label="$t('settings.tibotTracking')" />
      </PropertyRow>
      <PropertyRow :label="$t('settings.tibotAuto')">
        <Switch v-model="tibot.auto" :label="$t('settings.tibotAuto')" />
      </PropertyRow>
      <PropertyRow :label="$t('settings.tibotParticles')">
        <Switch v-model="tibot.particles" :label="$t('settings.tibotParticles')" />
      </PropertyRow>
      <PropertyRow :label="$t('settings.tibotPaused')">
        <Switch v-model="tibot.paused" :label="$t('settings.tibotPaused')" />
      </PropertyRow>
    </div>

    <div class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-3">
      <p class="mb-2 px-1 text-[12px] font-medium">{{ $t('settings.tibotActions') }}</p>
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="action in TIBOT_ACTIONS"
          :key="action"
          type="button"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-2 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          @click="play(action)"
        >
          {{ actionLabels[action] }}
        </button>
      </div>
    </div>
  </div>
</template>
