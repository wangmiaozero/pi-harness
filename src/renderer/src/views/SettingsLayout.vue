<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import {
  Activity,
  AppWindow,
  Archive,
  Code2,
  Download,
  FileCode2,
  FolderOpen,
  PanelLeft,
  Settings2,
  SlidersHorizontal,
  Sparkles
} from '@lucide/vue'
import Badge from '@renderer/components/ui/Badge.vue'
import { getApi } from '@renderer/composables/useApi'
import { useSettingsStore } from '@renderer/stores/settings'
import { APP_VERSION } from '@shared/constants'
import { MASCOT_ENABLED } from '@shared/feature-flags'

const { t } = useI18n()
const route = useRoute()
const settings = useSettingsStore()
const appVersion = ref(APP_VERSION)
const packaged = ref(false)
const systemInfoReady = ref(false)

const menuItems = computed(() => {
  const items = [
    {
      id: 'general',
      to: '/settings/general',
      label: t('settings.general'),
      icon: SlidersHorizontal
    },
    { id: 'nav', to: '/settings/nav', label: t('settings.navOrder'), icon: PanelLeft },
    { id: 'mascot', to: '/settings/mascot', label: t('settings.mascot'), icon: Sparkles },
    { id: 'workspace', to: '/settings/workspace', label: t('settings.workspace'), icon: AppWindow },
    { id: 'config', to: '/settings/config', label: t('nav.config'), icon: FileCode2 },
    { id: 'paths', to: '/settings/paths', label: t('settings.manualPaths'), icon: FolderOpen },
    { id: 'backup', to: '/settings/backup', label: t('settings.backup'), icon: Archive },
    {
      id: 'diagnostics',
      to: '/settings/diagnostics',
      label: t('nav.diagnostics'),
      icon: Activity
    }
  ]
  if (packaged.value) {
    items.push({
      id: 'updates',
      to: '/settings/updates',
      label: t('settings.updates'),
      icon: Download
    })
  }
  if (systemInfoReady.value && !packaged.value) {
    items.push({
      id: 'developer',
      to: '/settings/developer',
      label: t('settings.developer'),
      icon: Code2
    })
  }
  return MASCOT_ENABLED ? items : items.filter((item) => item.id !== 'mascot')
})

onMounted(async () => {
  try {
    const info = await getApi().system.info()
    appVersion.value = info.appVersion
    packaged.value = info.packaged
  } catch {
    packaged.value = false
  } finally {
    systemInfoReady.value = true
  }
})
</script>

<template>
  <div data-testid="settings-layout" class="flex h-full min-h-0 overflow-hidden">
    <aside
      class="settings-sidebar flex w-[220px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)]"
    >
      <div
        class="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3"
      >
        <Settings2 class="size-4 text-[var(--text-secondary)]" :stroke-width="1.75" />
        <span class="text-[13px] font-semibold text-[var(--text-primary)]">
          {{ $t('settings.title') }}
        </span>
      </div>

      <nav
        data-testid="settings-home"
        :aria-label="$t('settings.title')"
        class="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2"
      >
        <RouterLink
          v-for="item in menuItems"
          :key="item.id"
          :to="item.to"
          :data-testid="`settings-section-${item.id}`"
          class="group flex h-9 min-w-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          :class="
            route.path === item.to
              ? 'bg-[var(--accent-tint)] font-medium text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          "
        >
          <component :is="item.icon" class="size-4 shrink-0" :stroke-width="1.75" />
          <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
          <Badge v-if="item.id === 'mascot' && !settings.settings?.mascotUnlocked" tone="warning">
            {{ $t('settings.mascotLocked') }}
          </Badge>
        </RouterLink>
      </nav>

      <div
        data-testid="settings-version"
        class="shrink-0 border-t border-[var(--border-subtle)] px-3 py-2.5"
      >
        <p class="text-[11px] font-medium text-[var(--text-secondary)]">Pi-Harness</p>
        <p
          class="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]"
        >
          {{ $t('settings.version', { version: appVersion }) }}
        </p>
      </div>
    </aside>

    <div class="min-h-0 min-w-0 flex-1">
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
@media (max-width: 880px) {
  .settings-sidebar {
    width: 184px;
  }
}
</style>
