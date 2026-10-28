<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import {
  Activity,
  Bot,
  FileText,
  Globe,
  Keyboard,
  Mic,
  Server,
  AppWindow,
  Archive,
  Code2,
  Download,
  Eraser,
  FileCode2,
  Fish,
  FolderOpen,
  Info,
  LayoutDashboard,
  PanelLeft,
  Settings2,
  SlidersHorizontal,
  Sparkles
} from '@lucide/vue'
import Input from '@renderer/components/ui/Input.vue'
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
const query = ref('')

const menuItems = computed(() => {
  const items = [
    {
      id: 'overview',
      to: '/settings/overview',
      label: t('nav.overview'),
      icon: LayoutDashboard
    },
    {
      id: 'general',
      to: '/settings/general',
      label: t('settings.general'),
      icon: SlidersHorizontal
    },
    { id: 'ai', to: '/settings/ai', label: t('agentSettings.ai'), icon: Sparkles },
    { id: 'voice', to: '/settings/voice', label: t('agentSettings.voice'), icon: Mic },
    {
      id: 'shortcuts',
      to: '/settings/shortcuts',
      label: t('agentSettings.shortcuts'),
      icon: Keyboard
    },
    {
      id: 'instructions',
      to: '/settings/instructions',
      label: t('agentSettings.instructions'),
      icon: FileText
    },
    { id: 'mcp', to: '/settings/mcp', label: t('agentSettings.mcp'), icon: Server },
    { id: 'subagents', to: '/settings/subagents', label: t('agentSettings.subagents'), icon: Bot },
    { id: 'remote', to: '/settings/remote', label: t('agentSettings.remote'), icon: Globe },
    { id: 'nav', to: '/settings/nav', label: t('settings.navOrder'), icon: PanelLeft },
    { id: 'mascot', to: '/settings/mascot', label: t('settings.mascot'), icon: Sparkles },
    {
      id: 'desktop-pet',
      to: '/settings/desktop-pet',
      label: t('settings.desktopPet'),
      icon: Fish
    },
    { id: 'workspace', to: '/settings/workspace', label: t('settings.workspace'), icon: AppWindow },
    {
      id: 'session-cleanup',
      to: '/settings/session-cleanup',
      label: t('settings.sessionCleanup.title'),
      icon: Eraser
    },
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
  items.push({
    id: 'updates',
    to: '/settings/updates',
    label: t('settings.updates'),
    icon: Download
  })
  items.push({
    id: 'about',
    to: '/settings/about',
    label: t('settings.about'),
    icon: Info
  })
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

const groups = computed(() => {
  const ids: Record<string, string[]> = {
    preferences: ['general', 'ai', 'voice', 'shortcuts', 'nav', 'mascot', 'desktop-pet'],
    agents: ['instructions', 'mcp', 'subagents'],
    workspace: ['overview', 'workspace', 'session-cleanup'],
    system: ['remote', 'config', 'paths', 'backup', 'diagnostics', 'updates', 'about', 'developer']
  }
  return Object.entries(ids)
    .map(([id, entries]) => ({
      id,
      items: menuItems.value.filter(
        (item) =>
          entries.includes(item.id) &&
          item.label.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
      )
    }))
    .filter((group) => group.items.length)
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

      <div class="relative px-2 pt-3 pb-1">
        <Input
          v-model="query"
          :placeholder="t('agentSettings.search')"
          :aria-label="t('agentSettings.search')"
        />
      </div>
      <nav
        data-testid="settings-home"
        :aria-label="$t('settings.title')"
        class="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2"
      >
        <p v-if="!groups.length" class="px-2 py-4 text-xs text-[var(--text-tertiary)]">
          {{ t('agentSettings.noResults') }}
        </p>
        <div v-for="group in groups" :key="group.id" class="pb-2">
          <h2 class="px-2.5 pt-3 pb-1.5 text-[10px] font-semibold text-[var(--text-tertiary)]">
            {{ t(`agentSettings.${group.id}`) }}
          </h2>
          <RouterLink
            v-for="item in group.items"
            :key="item.id"
            :to="item.to"
            :data-testid="`settings-section-${item.id}`"
            class="group flex h-10 min-w-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
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
        </div>
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
