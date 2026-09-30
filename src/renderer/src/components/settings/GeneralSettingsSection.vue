<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Trash2, Upload } from '@lucide/vue'
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
import Button from '@renderer/components/ui/Button.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'
import {
  CHAT_PARTICIPANT_NAME_MAX_LENGTH,
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_USER_NAME,
  normalizeAssistantName,
  normalizeUserName
} from '@shared/constants/chat-participants'
import {
  DEFAULT_MACOS27_BACKGROUND,
  MACOS27_BACKGROUNDS,
  MACOS27_BACKGROUND_IMAGE_MIME_TYPES,
  MAX_MACOS27_BACKGROUND_IMAGE_BYTES,
  isMacOS27BackgroundImageDataUrl,
  type MacOS27Background
} from '@shared/constants/macos27-background'

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
  cyan: 'themeCyan',
  'macos27-light': 'themeMacos27Light',
  macos27: 'themeMacos27Dark'
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

const macos27BackgroundOptions = computed(() =>
  MACOS27_BACKGROUNDS.map((background) => ({
    value: background,
    label: t(
      `settings.macos27Background${background.replace(/(^|-)(\w)/g, (_, __, letter) => letter.toUpperCase())}`
    )
  }))
)

const macos27Background = computed(
  () => draft.value.macos27Background ?? DEFAULT_MACOS27_BACKGROUND
)
const macos27BackgroundImage = computed(() => draft.value.macos27BackgroundImage ?? null)
const backgroundImageInput = ref<HTMLInputElement | null>(null)

const macos27ThemeActive = computed(
  () => draft.value.theme === 'macos27' || draft.value.theme === 'macos27-light'
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

function onMacOS27BackgroundChange(value: string): void {
  draft.value.macos27Background = value as MacOS27Background
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('invalid image'))
    )
    reader.addEventListener('error', () => reject(reader.error ?? new Error('image read failed')))
    reader.readAsDataURL(file)
  })
}

async function onMacOS27BackgroundImageSelected(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (
    !MACOS27_BACKGROUND_IMAGE_MIME_TYPES.includes(
      file.type as (typeof MACOS27_BACKGROUND_IMAGE_MIME_TYPES)[number]
    )
  ) {
    toast.error(t('settings.macos27BackgroundImageUnsupported'))
    return
  }
  if (file.size > MAX_MACOS27_BACKGROUND_IMAGE_BYTES) {
    toast.error(t('settings.macos27BackgroundImageTooLarge'))
    return
  }
  try {
    const dataUrl = await readImageAsDataUrl(file)
    if (!isMacOS27BackgroundImageDataUrl(dataUrl)) throw new Error('invalid image data')
    draft.value.macos27BackgroundImage = dataUrl
    draft.value.macos27Background = 'local-image'
  } catch {
    toast.error(t('settings.macos27BackgroundImageReadFailed'))
  }
}

function clearMacOS27BackgroundImage(): void {
  draft.value.macos27BackgroundImage = null
  if (draft.value.macos27Background === 'local-image') {
    draft.value.macos27Background = DEFAULT_MACOS27_BACKGROUND
  }
}

function normalizeAssistantNameInput(): void {
  draft.value.assistantName = normalizeAssistantName(draft.value.assistantName)
}

function normalizeUserNameInput(): void {
  draft.value.userName = normalizeUserName(draft.value.userName)
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
      <Select
        v-if="macos27ThemeActive"
        :model-value="macos27Background"
        :label="$t('settings.macos27Background')"
        :options="macos27BackgroundOptions"
        layout="row"
        data-testid="macos27-background-select"
        @update:model-value="onMacOS27BackgroundChange"
      />
      <PropertyRow v-if="macos27ThemeActive" :label="$t('settings.macos27BackgroundImage')">
        <div class="ml-auto flex items-center justify-end gap-2">
          <div
            v-if="macos27BackgroundImage"
            class="h-8 w-12 overflow-hidden rounded-[var(--radius-xs)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)]"
            data-testid="macos27-background-image-preview"
          >
            <img :src="macos27BackgroundImage" alt="" class="size-full object-cover" />
          </div>
          <input
            ref="backgroundImageInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="sr-only"
            data-testid="macos27-background-image-input"
            @change="onMacOS27BackgroundImageSelected"
          />
          <Button
            variant="secondary"
            size="sm"
            data-testid="macos27-background-image-upload"
            @click="backgroundImageInput?.click()"
          >
            <Upload class="size-3.5" :stroke-width="1.75" />
            {{
              $t(
                macos27BackgroundImage
                  ? 'settings.macos27BackgroundImageReplace'
                  : 'settings.macos27BackgroundImageUpload'
              )
            }}
          </Button>
          <Button
            v-if="macos27BackgroundImage"
            variant="ghost"
            size="sm"
            :aria-label="$t('settings.macos27BackgroundImageClear')"
            data-testid="macos27-background-image-clear"
            @click="clearMacOS27BackgroundImage"
          >
            <Trash2 class="size-3.5" :stroke-width="1.75" />
          </Button>
        </div>
      </PropertyRow>
      <PropertyRow :label="$t('settings.userName')">
        <input
          v-model="draft.userName"
          type="text"
          :maxlength="CHAT_PARTICIPANT_NAME_MAX_LENGTH"
          :placeholder="DEFAULT_USER_NAME"
          :aria-label="$t('settings.userName')"
          data-testid="user-name-input"
          class="ml-auto block h-7 w-full max-w-[280px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2.5 text-right text-[12px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--accent-border)] focus:shadow-[var(--focus-ring)]"
          @blur="normalizeUserNameInput"
        />
      </PropertyRow>
      <PropertyRow :label="$t('settings.assistantName')">
        <input
          v-model="draft.assistantName"
          type="text"
          :maxlength="CHAT_PARTICIPANT_NAME_MAX_LENGTH"
          :placeholder="DEFAULT_ASSISTANT_NAME"
          :aria-label="$t('settings.assistantName')"
          data-testid="assistant-name-input"
          class="ml-auto block h-7 w-full max-w-[280px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2.5 text-right text-[12px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--accent-border)] focus:shadow-[var(--focus-ring)]"
          @blur="normalizeAssistantNameInput"
        />
      </PropertyRow>
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
