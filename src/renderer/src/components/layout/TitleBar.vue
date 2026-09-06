<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Minus, Square, X } from '@lucide/vue'
import { getApi } from '@renderer/composables/useApi'
import { APP_VERSION } from '@shared/constants/index'
import classicAppIconUrl from '@renderer/assets/app-icon-classic.png?url'
import mingAppIconUrl from '../../../../../build/icon.png?url'
import mingTitlebarCalligraphyUrl from '@renderer/assets/themes/ming-dynasty/titlebar-calligraphy.png?url'

const router = useRouter()
const props = withDefaults(defineProps<{ starshipCockpit?: boolean; mingDynasty?: boolean }>(), {
  starshipCockpit: false,
  mingDynasty: false
})
const isMac = ref(false)
const isWin = ref(false)
const showLeadingWindowControls = ref(!navigator.platform.startsWith('Win'))
const titlebarIconUrl = computed(() => (props.mingDynasty ? mingAppIconUrl : classicAppIconUrl))

onMounted(async () => {
  try {
    const info = await getApi().system.info()
    isMac.value = info.platform === 'darwin'
    isWin.value = info.platform === 'win32'
    showLeadingWindowControls.value = info.platform !== 'win32'
  } catch {
    isMac.value = navigator.platform.startsWith('Mac')
    isWin.value = navigator.platform.startsWith('Win')
    showLeadingWindowControls.value = !isWin.value
  }
})

const modKey = computed(() => (isMac.value ? '⌘' : 'Ctrl'))

function openPalette() {
  window.dispatchEvent(new CustomEvent('pi-harness:open-palette'))
}

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
    class="app-titlebar drag-region relative flex h-[var(--titlebar-height)] shrink-0 items-center bg-[var(--bg-titlebar)]"
    :class="isMac ? 'pl-[76px] pr-3' : 'pl-3 pr-1'"
  >
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
      <img :src="classicAppIconUrl" alt="" class="starship-titlebar-identity__icon" />
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
      v-if="mingDynasty"
      :src="mingTitlebarCalligraphyUrl"
      alt=""
      class="ming-titlebar-calligraphy pointer-events-none absolute"
      data-testid="ming-titlebar-calligraphy"
      draggable="false"
      aria-hidden="true"
    />

    <div class="ml-auto flex items-center gap-1">
      <!-- Command palette trigger styled like an NSToolbar search field. -->
      <button
        type="button"
        class="starship-search-trigger no-drag flex h-7 w-[200px] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] pl-2 pr-1.5 text-[11.5px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:border-[var(--accent)] focus-visible:shadow-[var(--focus-ring)]"
        :title="$t('titlebar.commandPalette')"
        @click="openPalette"
      >
        <Search class="size-3" :stroke-width="1.75" />
        <span class="flex-1 text-left">{{ $t('common.search') }}</span>
        <kbd
          class="rounded border border-[var(--border-default)] bg-[var(--bg-hover)] px-1 font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]"
        >
          {{ modKey }}K
        </kbd>
      </button>

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
  top: 50%;
  left: 14px;
  gap: 9px;
  transform: translateY(-50%);
}

.titlebar-window-control {
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
