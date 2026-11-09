<script setup lang="ts">
import { marketFileUrl } from '@shared/market/urls'

const frame = (name: string) => marketFileUrl('theme', 'starship', `assets/${name}`)
const topLeftImage = frame('cockpit-top-left.png')
const topImage = frame('cockpit-top.png')
const topRightImage = frame('cockpit-top-right.png')
const leftImage = frame('cockpit-left.png')
const rightImage = frame('cockpit-right.png')
const bottomLeftImage = frame('cockpit-bottom-left.png')
const bottomImage = frame('cockpit-bottom.png')
const bottomRightImage = frame('cockpit-bottom-right.png')

const frameSegments = [
  { area: 'top-left', image: topLeftImage },
  { area: 'top', image: topImage },
  { area: 'top-right', image: topRightImage },
  { area: 'left', image: leftImage },
  { area: 'right', image: rightImage },
  { area: 'bottom-left', image: bottomLeftImage },
  { area: 'bottom', image: bottomImage },
  { area: 'bottom-right', image: bottomRightImage }
] as const

const frameLayers = ['structure', 'energy'] as const
</script>

<template>
  <div
    data-testid="starship-cockpit-frame"
    class="pointer-events-none contents select-none"
    aria-hidden="true"
  >
    <div
      v-for="layer in frameLayers"
      :key="layer"
      class="starship-cockpit-frame absolute inset-0"
      :class="`starship-cockpit-frame--${layer}`"
    >
      <span
        v-for="segment in frameSegments"
        :key="segment.area"
        class="starship-cockpit-frame__segment"
        :data-frame-area="segment.area"
        :style="{ backgroundImage: `url(${segment.image})` }"
      />
    </div>
  </div>
</template>
