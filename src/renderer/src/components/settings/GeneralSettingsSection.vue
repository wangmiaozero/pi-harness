<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppSettings } from '@shared/ipc/api-types'
import { APP_LANGUAGE_LABELS, APP_LANGUAGES } from '@shared/constants/language'
import { APP_THEMES, type AppTheme } from '@shared/constants/theme'
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
    </div>
  </InspectorSection>
</template>
