<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageHeader from '@renderer/components/common/PageHeader.vue'
import { getApi } from '@renderer/composables/useApi'
import GeneralSettingsSection from '@renderer/components/settings/GeneralSettingsSection.vue'
import NavSettingsSection from '@renderer/components/settings/NavSettingsSection.vue'
import MascotSettingsSection from '@renderer/components/settings/MascotSettingsSection.vue'
import WorkspaceSettingsSection from '@renderer/components/settings/WorkspaceSettingsSection.vue'
import PathsSettingsSection from '@renderer/components/settings/PathsSettingsSection.vue'
import BackupSettingsSection from '@renderer/components/settings/BackupSettingsSection.vue'
import UpdatesSettingsSection from '@renderer/components/settings/UpdatesSettingsSection.vue'
import DeveloperSettingsSection from '@renderer/components/settings/DeveloperSettingsSection.vue'
import { useSettingsDraft } from '@renderer/components/settings/useSettingsDraft'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'
import { MASCOT_ENABLED } from '@shared/feature-flags'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { draft } = useSettingsDraft()

provide(SETTINGS_DRAFT_KEY, draft)

const SETTINGS_SECTIONS_ALL = [
  'general',
  'nav',
  'mascot',
  'workspace',
  'paths',
  'backup',
  'updates',
  'developer'
] as const
const SETTINGS_SECTIONS = MASCOT_ENABLED
  ? SETTINGS_SECTIONS_ALL
  : SETTINGS_SECTIONS_ALL.filter(
      (id): id is Exclude<(typeof SETTINGS_SECTIONS_ALL)[number], 'mascot'> => id !== 'mascot'
    )
type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]

function isSettingsSection(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value)
}

/** Developer controls are for local `pnpm dev` only — hidden when packaged. */
const packaged = ref<boolean | null>(null)

const section = computed<SettingsSectionId | null>(() => {
  const raw = route.params.section
  const id = Array.isArray(raw) ? raw[0] : raw
  return isSettingsSection(id) ? id : null
})

const sectionTitle = computed(() => {
  switch (section.value) {
    case 'general':
      return t('settings.general')
    case 'nav':
      return t('settings.navOrder')
    case 'mascot':
      return t('settings.mascot')
    case 'workspace':
      return t('settings.workspace')
    case 'paths':
      return t('settings.manualPaths')
    case 'backup':
      return t('settings.backup')
    case 'updates':
      return t('settings.updates')
    case 'developer':
      return t('settings.developer')
    default:
      return t('settings.title')
  }
})

const sectionSubtitle = computed(() => {
  switch (section.value) {
    case 'general':
      return t('settings.sectionGeneralHint')
    case 'nav':
      return t('settings.sectionNavHint')
    case 'mascot':
      return t('settings.sectionMascotHint')
    case 'workspace':
      return t('settings.sectionWorkspaceHint')
    case 'paths':
      return t('settings.sectionPathsHint')
    case 'backup':
      return t('settings.sectionBackupHint')
    case 'updates':
      return t('settings.sectionUpdatesHint')
    case 'developer':
      return t('settings.sectionDeveloperHint')
    default:
      return t('settings.subtitle')
  }
})

watch([section, packaged], ([current, isPackaged]) => {
  if (!isSettingsSection(current)) {
    void router.replace('/settings/general')
    return
  }
  if (current === 'developer' && isPackaged === true) void router.replace('/settings/general')
})

onMounted(() => {
  void getApi()
    .system.info()
    .then((info) => {
      packaged.value = info.packaged
    })
    .catch(() => {
      packaged.value = false
    })
})
</script>

<template>
  <div class="settings-view flex h-full min-h-0 flex-col">
    <PageHeader>
      <div class="flex min-w-0 flex-col justify-center self-stretch">
        <h1
          class="text-[15px] font-semibold leading-[18px] tracking-tight text-[var(--text-primary)]"
        >
          {{ sectionTitle }}
        </h1>
        <p class="mt-[3px] text-[11.5px] leading-[14px] text-[var(--text-tertiary)]">
          {{ sectionSubtitle }}
        </p>
      </div>
    </PageHeader>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto">
        <div
          class="mx-auto w-full space-y-5 px-6 py-5"
          :class="
            section === 'mascot' && draft.mascotUnlocked
              ? 'settings-mascot-gallery'
              : 'max-w-[720px]'
          "
        >
          <GeneralSettingsSection v-if="section === 'general'" />
          <NavSettingsSection v-else-if="section === 'nav'" />
          <MascotSettingsSection v-else-if="section === 'mascot'" />
          <WorkspaceSettingsSection v-else-if="section === 'workspace'" />
          <PathsSettingsSection v-else-if="section === 'paths'" />
          <BackupSettingsSection v-else-if="section === 'backup'" />
          <UpdatesSettingsSection v-else-if="section === 'updates'" />
          <DeveloperSettingsSection v-else-if="section === 'developer'" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-mascot-gallery {
  container: mascot-gallery / inline-size;
}
</style>
