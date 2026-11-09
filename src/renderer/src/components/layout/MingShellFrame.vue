<script setup lang="ts">
import { computed } from 'vue'
import { marketFileUrl } from '@shared/market/urls'
import { themePackForStyle } from '@shared/market/style-packs'
import { useSettingsStore } from '@renderer/stores/settings'

const settings = useSettingsStore()
const frameStyle = computed(() => {
  const pack = themePackForStyle(settings.settings?.mascotStyle) ?? 'ming-snow'
  return {
    '--ming-frame-corner': `url("${marketFileUrl('theme', pack, 'assets/frame-corner-v2.png')}")`,
    '--ming-frame-rail': `url("${marketFileUrl('theme', pack, 'assets/frame-rail-v2.png')}")`
  }
})
</script>

<template>
  <div
    class="ming-shell-frame"
    data-testid="ming-shell-frame"
    :style="frameStyle"
    aria-hidden="true"
  >
    <span class="ming-shell-frame__rail ming-shell-frame__rail--top" />
    <span class="ming-shell-frame__rail ming-shell-frame__rail--right" />
    <span class="ming-shell-frame__rail ming-shell-frame__rail--bottom" />
    <span class="ming-shell-frame__rail ming-shell-frame__rail--left" />
    <span class="ming-shell-frame__corner ming-shell-frame__corner--top-left" />
    <span class="ming-shell-frame__corner ming-shell-frame__corner--top-right" />
    <span class="ming-shell-frame__corner ming-shell-frame__corner--bottom-right" />
    <span class="ming-shell-frame__corner ming-shell-frame__corner--bottom-left" />
  </div>
</template>
