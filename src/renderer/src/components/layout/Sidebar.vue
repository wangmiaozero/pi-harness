<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { LayoutDashboard, Box, Cpu, Activity, Settings, Sparkles, FileCode2 } from '@lucide/vue'
import { APP_VERSION } from '@shared/constants/index'

const route = useRoute()
const { t } = useI18n()

const navItems = computed(() => [
  { name: 'overview', to: '/', icon: LayoutDashboard, label: t('nav.overview') },
  { name: 'providers', to: '/providers', icon: Box, label: t('nav.providers') },
  { name: 'models', to: '/models', icon: Cpu, label: t('nav.models') },
  { name: 'skills', to: '/skills', icon: Sparkles, label: t('nav.skills') },
  { name: 'config', to: '/config', icon: FileCode2, label: t('nav.config') },
  { name: 'diagnostics', to: '/diagnostics', icon: Activity, label: t('nav.diagnostics') },
  { name: 'settings', to: '/settings', icon: Settings, label: t('nav.settings') }
])

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<template>
  <!-- macOS Source List. Background is intentionally a touch darker than the
       workspace; selected item is a soft accent tint, not a loud grey block. -->
  <aside class="flex w-[var(--sidebar-width)] shrink-0 flex-col bg-[var(--bg-sidebar)]">
    <nav class="flex flex-1 flex-col gap-px px-1.5 pt-2">
      <RouterLink
        v-for="item in navItems"
        :key="item.name"
        :to="item.to"
        class="group relative flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] no-drag"
        :class="
          isActive(item.to)
            ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        "
        :style="{ height: 'var(--height-row)' }"
      >
        <!-- 2px accent indicator on the leading edge of the active row. -->
        <span
          v-if="isActive(item.to)"
          class="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
        />
        <component
          :is="item.icon"
          class="size-[15px] shrink-0"
          :stroke-width="1.75"
          :class="
            isActive(item.to)
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]'
          "
        />
        <span
          class="truncate text-[13px]"
          :class="isActive(item.to) ? 'font-medium' : 'font-normal'"
          :title="item.label"
        >
          {{ item.label }}
        </span>
      </RouterLink>
    </nav>
    <div class="px-3 py-2">
      <p class="text-[10.5px] text-[var(--text-tertiary)]">Pi-Switch v{{ APP_VERSION }}</p>
    </div>
  </aside>
</template>
