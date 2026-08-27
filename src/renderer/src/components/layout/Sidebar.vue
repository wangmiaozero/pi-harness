<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  LayoutDashboard,
  Box,
  Cpu,
  Activity,
  Settings,
  Sparkles,
  FileCode2,
  SquareTerminal
} from '@lucide/vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { normalizeNavOrder, type NavItemId } from '@shared/constants/navigation'

const route = useRoute()
const { t } = useI18n()
const settings = useSettingsStore()

const catalog = computed(
  (): Record<
    NavItemId,
    { name: NavItemId; to: string; icon: typeof SquareTerminal; label: string; short: string }
  > => ({
    workspace: {
      name: 'workspace',
      to: '/workspace',
      icon: SquareTerminal,
      label: t('nav.workspace'),
      short: t('navShort.workspace')
    },
    overview: {
      name: 'overview',
      to: '/',
      icon: LayoutDashboard,
      label: t('nav.overview'),
      short: t('navShort.overview')
    },
    providers: {
      name: 'providers',
      to: '/providers',
      icon: Box,
      label: t('nav.providers'),
      short: t('navShort.providers')
    },
    models: {
      name: 'models',
      to: '/models',
      icon: Cpu,
      label: t('nav.models'),
      short: t('navShort.models')
    },
    skills: {
      name: 'skills',
      to: '/skills',
      icon: Sparkles,
      label: t('nav.skills'),
      short: t('navShort.skills')
    },
    config: {
      name: 'config',
      to: '/config',
      icon: FileCode2,
      label: t('nav.config'),
      short: t('navShort.config')
    },
    diagnostics: {
      name: 'diagnostics',
      to: '/diagnostics',
      icon: Activity,
      label: t('nav.diagnostics'),
      short: t('navShort.diagnostics')
    },
    settings: {
      name: 'settings',
      to: '/settings',
      icon: Settings,
      label: t('nav.settings'),
      short: t('navShort.settings')
    }
  })
)

const navItems = computed(() =>
  normalizeNavOrder(settings.settings?.navOrder).map((id) => catalog.value[id])
)

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<template>
  <!-- 50px icon rail. Labels live in title + sr-only so hover / a11y / e2e still work. -->
  <aside
    class="app-navigation-rail flex w-[var(--sidebar-width)] shrink-0 flex-col items-center bg-[var(--bg-sidebar)]"
    data-testid="app-navigation-rail"
  >
    <nav class="flex w-full flex-1 flex-col items-center gap-1 px-1 pt-2">
      <RouterLink
        v-for="item in navItems"
        :key="item.name"
        :to="item.to"
        :title="item.label"
        class="group relative flex w-full flex-col items-center justify-center gap-1.5 rounded-[var(--radius-sm)] py-2.5 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] no-drag"
        :class="
          isActive(item.to)
            ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        "
      >
        <span
          v-if="isActive(item.to)"
          class="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
        />
        <component
          :is="item.icon"
          class="size-4 shrink-0"
          :stroke-width="1.75"
          :class="
            isActive(item.to)
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]'
          "
        />
        <span
          class="text-[10px] leading-none tracking-tight"
          :class="isActive(item.to) ? 'font-medium' : 'font-normal'"
        >
          {{ item.short }}
        </span>
      </RouterLink>
    </nav>
  </aside>
</template>
