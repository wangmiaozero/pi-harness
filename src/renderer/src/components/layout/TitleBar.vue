<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Minus, Square, X, PanelLeft } from '@lucide/vue'
import { getApi } from '@renderer/composables/useApi'
import { useWorkspaceSidebarState } from '@renderer/composables/useWorkspaceSidebarState'
import NavigationTooltip from './NavigationTooltip.vue'
import { APP_VERSION } from '@shared/constants/index'
import { resolveAppIcon } from '@shared/constants/app-icon'
import { useSettingsStore } from '@renderer/stores/settings'
import classicAppIconUrl from '@renderer/assets/app-icon-classic.png?url'
import mingAppIconUrl from '../../../../../build/app-icons/ming.png?url'
import quantumAppIconUrl from '../../../../../build/app-icons/quantum.png?url'
import mingTitlebarCalligraphyUrl from '@renderer/assets/themes/ming-dynasty/titlebar-calligraphy.png?url'
import zhangTitlebarCalligraphyUrl from '@renderer/assets/themes/zhang-juzheng-snow/titlebar-calligraphy-overlay.png?url'

const router = useRouter()
const route = useRoute()
const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useWorkspaceSidebarState()
const settings = useSettingsStore()
const props = withDefaults(
  defineProps<{ starshipCockpit?: boolean; mingDynasty?: boolean; zhangJuzheng?: boolean }>(),
  {
    starshipCockpit: false,
    mingDynasty: false,
    zhangJuzheng: false
  }
)
const isWin = ref(false)
const showLeadingWindowControls = ref(!navigator.platform.startsWith('Win'))
const titlebarIconUrl = computed(() => {
  const icon = resolveAppIcon(settings.settings?.appIcon ?? 'auto', props.mingDynasty)
  return { classic: classicAppIconUrl, ming: mingAppIconUrl, quantum: quantumAppIconUrl }[icon]
})

onMounted(async () => {
  try {
    const info = await getApi().system.info()
    isWin.value = info.platform === 'win32'
    showLeadingWindowControls.value = info.platform !== 'win32'
  } catch {
    isWin.value = navigator.platform.startsWith('Win')
    showLeadingWindowControls.value = !isWin.value
  }
})

async function minimize() {
  await getApi().window.minimize()
}
async function maximizeToggle() {
  await getApi().window.maximizeToggle()
}
async function close() {
  await getApi().window.close()
}
</script>

<template>
  <header
    class="app-titlebar relative flex h-[var(--titlebar-height)] shrink-0 items-center bg-[var(--bg-titlebar)]"
    :style="{
      '--titlebar-leading-end': `${(showLeadingWindowControls ? (mingDynasty ? 112 : 88) : 12) + (route.path.startsWith('/workspace') ? 40 : 0)}px`
    }"
    :class="
      showLeadingWindowControls ? (mingDynasty ? 'pl-[112px] pr-3' : 'pl-[88px] pr-3') : 'pl-3 pr-1'
    "
  >
    <NavigationTooltip
      v-if="route.path.startsWith('/workspace')"
      :label="sidebarCollapsed ? $t('workspace.expandSidebar') : $t('workspace.collapseSidebar')"
    >
      <button
        type="button"
        data-testid="workspace-sidebar-toggle"
        class="no-drag relative z-20 mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        :aria-label="
          sidebarCollapsed ? $t('workspace.expandSidebar') : $t('workspace.collapseSidebar')
        "
        :aria-expanded="!sidebarCollapsed"
        aria-controls="workspace-project-sidebar"
        @click="toggleSidebar"
      >
        <PanelLeft class="size-[18px]" :stroke-width="1.75" aria-hidden="true" />
      </button>
    </NavigationTooltip>
    <!-- Only this empty area is draggable; controls never overlap a native drag region. -->
    <div class="drag-region min-w-0 flex-1 self-stretch" data-testid="titlebar-drag-area" />
    <div
      v-if="showLeadingWindowControls"
      class="titlebar-window-controls titlebar-window-controls--leading no-drag"
      data-testid="titlebar-window-controls"
    >
      <button
        type="button"
        class="titlebar-window-control titlebar-window-control--close"
        :aria-label="$t('titlebar.close')"
        data-testid="titlebar-window-close"
        @click="close"
      >
        <X aria-hidden="true" />
      </button>
      <button
        type="button"
        class="titlebar-window-control titlebar-window-control--minimize"
        :aria-label="$t('titlebar.minimize')"
        data-testid="titlebar-window-minimize"
        @click="minimize"
      >
        <Minus aria-hidden="true" />
      </button>
      <button
        type="button"
        class="titlebar-window-control titlebar-window-control--maximize"
        :aria-label="$t('titlebar.maximize')"
        data-testid="titlebar-window-maximize"
        @click="maximizeToggle"
      >
        <Square aria-hidden="true" />
      </button>
    </div>

    <div v-if="starshipCockpit" class="starship-titlebar-identity pointer-events-none">
      <img :src="titlebarIconUrl" alt="" class="starship-titlebar-identity__icon" />
      <span>
        <strong>PI-HARNESS v{{ APP_VERSION }}</strong>
        <small>星际驾驶舱 · 就绪</small>
      </span>
    </div>
    <div
      class="app-titlebar-brand pointer-events-none absolute inset-x-0 flex justify-center"
      data-testid="titlebar-brand"
    >
      <button
        type="button"
        class="app-titlebar-brand-button pointer-events-auto no-drag flex flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        :title="`Pi-Harness v${APP_VERSION}`"
        @click="router.push('/')"
      >
        <img
          :src="titlebarIconUrl"
          alt=""
          class="app-titlebar-brand-icon size-[18px] rounded-[4px]"
          data-testid="titlebar-brand-icon"
          draggable="false"
        />
        <span
          class="app-titlebar-brand-name text-[11px] font-medium leading-none tracking-tight text-[var(--text-secondary)]"
        >
          Pi-Harness<span v-if="mingDynasty"> v{{ APP_VERSION }}</span>
        </span>
        <span v-if="mingDynasty" class="ming-titlebar-subtitle">
          {{ $t('titlebar.mingSubtitle') }}
        </span>
        <span
          v-if="starshipCockpit"
          class="starship-titlebar-subtitle font-[family-name:var(--font-mono)] text-[7px] font-semibold leading-none tracking-[0.22em] text-[var(--accent)]"
        >
          STARSHIP COCKPIT
        </span>
      </button>
    </div>

    <img
      v-if="mingDynasty && !zhangJuzheng"
      :src="mingTitlebarCalligraphyUrl"
      alt=""
      class="ming-titlebar-calligraphy pointer-events-none absolute"
      data-testid="ming-titlebar-calligraphy"
      draggable="false"
      aria-hidden="true"
    />

    <div
      v-if="zhangJuzheng"
      class="zhang-titlebar-motto pointer-events-none absolute"
      data-testid="zhang-titlebar-motto"
      aria-hidden="true"
    >
      <img
        :src="zhangTitlebarCalligraphyUrl"
        alt=""
        class="zhang-titlebar-calligraphy-image"
        data-testid="zhang-titlebar-calligraphy-image"
        draggable="false"
      />
      <span>
        经世济民
        <small>修身 · 齐家 · 治国 · 平天下</small>
      </span>
    </div>

    <div class="ml-auto flex items-center gap-1">
      <div id="titlebar-workspace-actions" class="no-drag relative z-20 flex items-center gap-1" />
      <template v-if="isWin">
        <button
          type="button"
          class="no-drag flex size-8 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          :aria-label="$t('titlebar.minimize')"
          @click="minimize"
        >
          <Minus class="size-3.5" />
        </button>
        <button
          type="button"
          class="no-drag flex size-8 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          :aria-label="$t('titlebar.maximize')"
          @click="maximizeToggle"
        >
          <Square class="size-3" />
        </button>
        <button
          type="button"
          class="no-drag flex size-8 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--error-tint)] hover:text-[var(--error)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          :aria-label="$t('titlebar.close')"
          @click="close"
        >
          <X class="size-3.5" />
        </button>
      </template>
    </div>
  </header>
</template>

<style scoped>
.titlebar-window-controls {
  position: absolute;
  z-index: 12;
  display: flex;
  align-items: center;
}

.titlebar-window-controls--leading {
  top: 0;
  bottom: 0;
  left: 14px;
  height: fit-content;
  margin-block: auto;
  gap: 9px;
}

.titlebar-window-control {
  -webkit-app-region: no-drag;
  display: grid;
  width: 13px;
  height: 13px;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgb(0 0 0 / 0.22);
  border-radius: 50%;
  box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.2);
}

.titlebar-window-control--close {
  background-color: #ff5f57;
}

.titlebar-window-control--minimize {
  background-color: #febc2e;
}

.titlebar-window-control--maximize {
  background-color: #28c840;
}

.titlebar-window-control svg {
  width: 8px;
  height: 8px;
  color: rgb(35 18 14 / 0.78);
  opacity: 0;
  stroke-width: 2.5;
  transition: opacity 100ms ease-out;
}

.titlebar-window-controls:hover .titlebar-window-control svg,
.titlebar-window-control:focus-visible svg {
  opacity: 1;
}

.titlebar-window-control:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
