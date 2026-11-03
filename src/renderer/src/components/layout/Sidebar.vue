<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Cpu, Settings, Sparkles, Home, GitBranch, History, MoreHorizontal } from '@lucide/vue'
import { useSettingsStore } from '@renderer/stores/settings'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem
} from 'reka-ui'
import {
  normalizeNavOrder,
  OVERFLOW_NAV_ITEM_IDS,
  type NavItemId
} from '@shared/constants/navigation'
import NavigationTooltip from './NavigationTooltip.vue'
import mingPlumBranchUrl from '@renderer/assets/themes/ming-dynasty/plum-branch.png?url'

const route = useRoute()
const { t } = useI18n()
const settings = useSettingsStore()

const catalog = computed(
  (): Record<NavItemId, { name: NavItemId; to: string; icon: typeof Home; label: string }> => ({
    'ai-sessions': {
      name: 'ai-sessions',
      to: '/ai-sessions',
      icon: History,
      label: t('nav.aiSessions')
    },
    workspace: {
      name: 'workspace',
      to: '/workspace',
      icon: Home,
      label: t('nav.home')
    },
    models: {
      name: 'models',
      to: '/models',
      icon: Cpu,
      label: t('nav.models')
    },
    skills: {
      name: 'skills',
      to: '/skills',
      icon: Sparkles,
      label: t('nav.skills')
    },
    settings: {
      name: 'settings',
      to: '/settings',
      icon: Settings,
      label: t('nav.settings')
    },
    git: {
      name: 'git',
      to: '/git',
      icon: GitBranch,
      label: t('nav.git')
    }
  })
)

const navItems = computed(() =>
  normalizeNavOrder(settings.settings?.navOrder).map((id) => catalog.value[id])
)

const moreOpen = ref(false)
const visibleItems = computed(() => [catalog.value.workspace, catalog.value.models])
const overflowItems = computed(() =>
  navItems.value.filter((item) => OVERFLOW_NAV_ITEM_IDS.includes(item.name))
)
const hiddenActive = computed(() => overflowItems.value.some((item) => isActive(item.to)))

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<template>
  <aside
    class="app-navigation-rail relative flex w-[var(--sidebar-width)] shrink-0 flex-col items-center bg-[var(--bg-sidebar)]"
    data-testid="app-navigation-rail"
  >
    <nav
      class="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-2 py-3"
      :aria-label="t('nav.home')"
    >
      <NavigationTooltip v-for="item in visibleItems" :key="item.name" :label="item.label">
        <RouterLink
          :to="item.to"
          :aria-label="item.label"
          :data-nav-id="item.name"
          class="navigation-rail-link flex size-9 max-w-full shrink-0 items-center justify-center rounded-[10px] transition-colors no-drag focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          :class="
            isActive(item.to)
              ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          "
        >
          <component
            :is="item.icon"
            class="size-5 shrink-0"
            :stroke-width="1.75"
            aria-hidden="true"
          />
        </RouterLink>
      </NavigationTooltip>
      <DropdownMenuRoot v-model:open="moreOpen" :modal="false">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            data-testid="navigation-more"
            :aria-label="t('nav.more')"
            class="flex size-9 max-w-full shrink-0 items-center justify-center rounded-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] no-drag focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            :class="{
              'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]': moreOpen || hiddenActive
            }"
          >
            <MoreHorizontal class="size-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuPortal>
          <DropdownMenuContent
            side="right"
            align="start"
            :side-offset="8"
            :collision-padding="12"
            data-testid="navigation-more-menu"
            :aria-label="t('nav.more')"
            class="z-50 max-h-[var(--reka-dropdown-menu-content-available-height)] w-52 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] p-2 text-[var(--text-primary)] shadow-xl"
          >
            <div v-for="item in overflowItems" :key="item.name" class="flex items-center gap-1">
              <DropdownMenuItem as-child>
                <RouterLink
                  :to="item.to"
                  class="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)]"
                  :class="{ 'bg-[var(--bg-surface-raised)]': isActive(item.to) }"
                >
                  <component :is="item.icon" class="size-[18px] shrink-0" aria-hidden="true" />
                  <span>{{ item.label }}</span>
                </RouterLink>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </nav>
    <div class="relative z-10 flex w-full shrink-0 justify-center px-2 py-3">
      <NavigationTooltip :label="catalog.settings.label">
        <RouterLink
          to="/settings"
          :aria-label="catalog.settings.label"
          data-testid="navigation-settings"
          data-nav-id="settings"
          class="navigation-rail-link flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors no-drag focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          :class="
            isActive('/settings')
              ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          "
        >
          <Settings class="size-5" :stroke-width="1.75" aria-hidden="true" />
        </RouterLink>
      </NavigationTooltip>
    </div>
    <img
      :src="mingPlumBranchUrl"
      alt=""
      class="ming-navigation-plum pointer-events-none absolute"
      data-testid="ming-navigation-plum"
      draggable="false"
      aria-hidden="true"
    />
  </aside>
</template>
