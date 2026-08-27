<script setup lang="ts">
import cockpitFrameImage from '@renderer/assets/themes/starship-cockpit/cockpit-frame-alpha.png'
</script>

<template>
  <div
    data-testid="starship-cockpit-frame"
    class="starship-cockpit-frame pointer-events-none contents select-none"
    aria-hidden="true"
  >
    <div class="starship-cockpit-frame__layer starship-cockpit-frame__layer--back absolute inset-0 z-[1] overflow-hidden">
      <img
        :src="cockpitFrameImage"
        alt=""
        draggable="false"
        class="starship-frame-art absolute inset-0 size-full max-w-none"
      />
    </div>
    <div class="starship-cockpit-frame__layer starship-cockpit-frame__layer--edge absolute inset-0 z-[30] overflow-hidden">
      <img
        :src="cockpitFrameImage"
        alt=""
        draggable="false"
        class="starship-frame-art absolute inset-0 size-full max-w-none"
      />
    </div>
  </div>
</template>
