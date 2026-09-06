<script setup lang="ts">
import frameCorner from '@renderer/assets/themes/ming-dynasty/frame-corner-v2.png'
import frameRail from '@renderer/assets/themes/ming-dynasty/frame-rail-v2.png'

const frameStyle = {
  '--ming-frame-corner': `url("${frameCorner}")`,
  '--ming-frame-rail': `url("${frameRail}")`
}
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
