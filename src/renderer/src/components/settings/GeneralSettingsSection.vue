<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppSettings } from '@shared/ipc/api-types'
import { APP_LANGUAGE_LABELS, APP_LANGUAGES } from '@shared/constants/language'
import { APP_THEMES, type AppTheme } from '@shared/constants/theme'
import { MASCOT_ENABLED } from '@shared/feature-flags'
import {
  APP_ICON_CHOICES,
  isMingDynastyTheme,
  resolveAppIcon,
  type AppIconId
} from '@shared/constants/app-icon'
import classicAppIconUrl from '@renderer/assets/app-icon-classic.png?url'
import mingAppIconUrl from '../../../../../build/app-icons/ming.png?url'
import quantumAppIconUrl from '../../../../../build/app-icons/quantum.png?url'
import Select from '@renderer/components/ui/Select.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const draft = inject(SETTINGS_DRAFT_KEY)!

const { t } = useI18n()

const THEME_LABEL_KEYS: Record<AppTheme, string> = {
  dark: 'themeDark',
  light: 'themeLight',
  pink: 'themePink',
  purple: 'themePurple',
  green: 'themeGreen',
  blue: 'themeBlue',
  orange: 'themeOrange',
  red: 'themeRed',
  cyan: 'themeCyan'
}

const languageOptions = computed(() =>
  APP_LANGUAGES.map((value) => ({
    value,
    label: value === 'auto' ? t('settings.languageAuto') : APP_LANGUAGE_LABELS[value]
  }))
)

const themeOptions = computed(() =>
  APP_THEMES.map((theme) => ({ value: theme, label: t(`settings.${THEME_LABEL_KEYS[theme]}`) }))
)

const iconImages: Record<AppIconId, string> = {
  classic: classicAppIconUrl,
  ming: mingAppIconUrl,
  quantum: quantumAppIconUrl
}
const iconOptions = computed(() =>
  APP_ICON_CHOICES.map((value) => ({
    value,
    image: iconImages[value],
    label: t(`settings.appIcon${value[0].toUpperCase()}${value.slice(1)}`)
  }))
)
const effectiveIcon = computed(() =>
  resolveAppIcon(
    draft.value.appIcon,
    isMingDynastyTheme(draft.value.mascotStyle, draft.value.mascotUnlocked)
  )
)

function onLanguageChange(value: string): void {
  draft.value.language = value as AppSettings['language']
}

function onThemeChange(value: string): void {
  draft.value.theme = value as AppTheme
}
</script>

<template>
  <InspectorSection
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <template #title>{{ $t('settings.general') }}</template>
    <div class="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
      <Select
        :model-value="draft.language"
        :label="$t('settings.language')"
        :options="languageOptions"
        layout="row"
        @update:model-value="onLanguageChange"
      />
      <Select
        :model-value="draft.theme"
        :label="$t('settings.theme')"
        :options="themeOptions"
        layout="row"
        @update:model-value="onThemeChange"
      />
      <fieldset class="px-3 py-3" data-testid="app-icon-settings">
        <legend class="sr-only">{{ $t('settings.appIcon') }}</legend>
        <div class="mb-2 text-[11.5px] font-medium text-[var(--text-secondary)]">
          {{ $t('settings.appIcon') }}
        </div>
        <div class="grid grid-cols-3 gap-2">
          <label
            v-for="option in iconOptions"
            :key="option.value"
            class="flex cursor-pointer flex-col items-center gap-1.5 rounded-[var(--radius-sm)] border p-2 transition-colors focus-within:shadow-[var(--focus-ring)]"
            :class="
              effectiveIcon === option.value
                ? 'border-[var(--accent)] bg-[var(--accent-tint)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] hover:border-[var(--border-strong)]'
            "
            :data-testid="`app-icon-option-${option.value}`"
          >
            <input
              v-model="draft.appIcon"
              class="sr-only"
              type="radio"
              name="app-icon"
              :value="option.value"
            />
            <img :src="option.image" alt="" class="size-12 object-contain" />
            <span class="text-[11px] text-[var(--text-secondary)]">{{ option.label }}</span>
          </label>
        </div>
        <label
          class="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-tertiary)]"
        >
          <input
            v-model="draft.appIcon"
            type="radio"
            name="app-icon"
            value="auto"
            data-testid="app-icon-option-auto"
          />
          <span>{{
            $t(MASCOT_ENABLED ? 'settings.appIconAuto' : 'settings.appIconAutoNoMascot')
          }}</span>
        </label>
      </fieldset>
      <PropertyRow :label="$t('settings.windowMotionEnabled')">
        <div class="flex items-center justify-end">
          <Switch
            v-model="draft.windowMotionEnabled"
            :label="$t('settings.windowMotionEnabled')"
            data-testid="window-motion-toggle"
          />
        </div>
      </PropertyRow>
      <PropertyRow :label="$t('settings.screenMotionEnabled')">
        <div class="flex items-center justify-end">
          <Switch
            v-model="draft.screenMotionEnabled"
            :label="$t('settings.screenMotionEnabled')"
            data-testid="screen-motion-toggle"
          />
        </div>
      </PropertyRow>
      <PropertyRow :label="$t('settings.composerFireEnabled')">
        <div class="flex items-center justify-end">
          <Switch
            v-model="draft.composerFireEnabled"
            :label="$t('settings.composerFireEnabled')"
            data-testid="composer-fire-toggle"
          />
        </div>
      </PropertyRow>
    </div>
  </InspectorSection>
</template>
