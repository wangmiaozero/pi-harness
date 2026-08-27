<script setup lang="ts">
import topLeftImage from '@renderer/assets/themes/starship-cockpit/cockpit-top-left.png'
import topImage from '@renderer/assets/themes/starship-cockpit/cockpit-top.png'
import topRightImage from '@renderer/assets/themes/starship-cockpit/cockpit-top-right.png'
import leftImage from '@renderer/assets/themes/starship-cockpit/cockpit-left.png'
import rightImage from '@renderer/assets/themes/starship-cockpit/cockpit-right.png'
import bottomLeftImage from '@renderer/assets/themes/starship-cockpit/cockpit-bottom-left.png'
import bottomImage from '@renderer/assets/themes/starship-cockpit/cockpit-bottom.png'
import bottomRightImage from '@renderer/assets/themes/starship-cockpit/cockpit-bottom-right.png'

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
