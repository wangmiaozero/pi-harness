<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Search, Minus, Square, X } from '@lucide/vue'
import { getApi } from '@renderer/composables/useApi'
import appIconUrl from '../../../../../build/icon.png?url'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const isMac = ref(false)
const isWin = ref(false)

onMounted(async () => {
  try {
    const info = await getApi().system.info()
    isMac.value = info.platform === 'darwin'
    isWin.value = info.platform === 'win32'
  } catch {
    isMac.value = navigator.platform.startsWith('Mac')
    isWin.value = navigator.platform.startsWith('Win')
  }
})

const title = computed(() => {
  const key = route.meta.i18nKey as string | undefined
  if (key) return t(key)
  return (route.meta.title as string) ?? 'Pi-Switch'
})
const modKey = computed(() => (isMac.value ? '⌘' : 'Ctrl'))

function openPalette() {
  window.dispatchEvent(new CustomEvent('pi-switch:open-palette'))
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
    class="drag-region relative flex h-[var(--titlebar-height)] shrink-0 items-center bg-[var(--bg-titlebar)]"
    :class="isMac ? 'pl-[76px] pr-3' : 'pl-3 pr-1'"
  >
    <button
      type="button"
      class="no-drag flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
      @click="router.push('/')"
    >
      <img :src="appIconUrl" alt="" class="size-[18px] rounded-[4px]" />
      <span class="text-[12px] font-medium tracking-tight text-[var(--text-secondary)]">
        Pi-Switch
      </span>
    </button>

    <div class="pointer-events-none absolute inset-x-0 flex justify-center">
      <span class="text-[11px] text-[var(--text-tertiary)]">{{ title }}</span>
    </div>

    <div class="ml-auto flex items-center gap-1">
      <!-- Command palette trigger styled like an NSToolbar search field. -->
      <button
        type="button"
        class="no-drag flex h-7 w-[200px] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] pl-2 pr-1.5 text-[11.5px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:border-[var(--accent)] focus-visible:shadow-[var(--focus-ring)]"
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
