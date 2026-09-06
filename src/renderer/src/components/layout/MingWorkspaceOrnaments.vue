<script setup lang="ts">
import calligraphyScrollUrl from '@renderer/assets/themes/ming-dynasty/calligraphy-scroll.png?url'
import statusScrollUrl from '@renderer/assets/themes/ming-dynasty/status-scroll.png?url'
</script>

<template>
  <div class="ming-workspace-ornaments" data-testid="ming-workspace-ornaments" aria-hidden="true">
    <img
      :src="calligraphyScrollUrl"
      alt=""
      class="ming-workspace-calligraphy"
      data-testid="ming-workspace-calligraphy"
      draggable="false"
    />
    <div class="ming-sidebar-scroll" data-testid="ming-sidebar-scroll">
      <img :src="statusScrollUrl" alt="" draggable="false" />
      <div class="ming-sidebar-scroll__copy">
        <strong>大明 · 星图</strong>
        <span>山河入卷 · 代码成章</span>
        <span>清风伴思 · 长夜有灯</span>
      </div>
      <span class="ming-sidebar-scroll__footer">千里江山，智在掌控</span>
    </div>
  </div>
</template>
