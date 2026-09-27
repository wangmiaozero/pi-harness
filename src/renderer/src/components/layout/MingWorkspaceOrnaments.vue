<script setup lang="ts">
import calligraphyScrollUrl from '@renderer/assets/themes/ming-dynasty/calligraphy-scroll.png?url'
import statusScrollUrl from '@renderer/assets/themes/ming-dynasty/status-scroll.png?url'
import governanceCalligraphyScrollUrl from '@renderer/assets/themes/zhang-juzheng-snow/calligraphy-scroll-governance.png?url'
import ministerCalligraphyScrollUrl from '@renderer/assets/themes/zhang-juzheng-snow/calligraphy-scroll-minister.png?url'
import springCalligraphyScrollUrl from '@renderer/assets/themes/zhang-juzheng-snow/calligraphy-scroll-spring.png?url'
import snowPlumLanternUrl from '@renderer/assets/themes/zhang-juzheng-snow/snow-plum-lantern.png?url'
import wangweiStatusScrollUrl from '@renderer/assets/themes/zhang-juzheng-snow/status-scroll-wangwei.png?url'

withDefaults(defineProps<{ zhangJuzheng?: boolean }>(), { zhangJuzheng: false })
</script>

<template>
  <div class="ming-workspace-ornaments" data-testid="ming-workspace-ornaments" aria-hidden="true">
    <template v-if="zhangJuzheng">
      <img
        :src="snowPlumLanternUrl"
        alt=""
        class="zhang-snow-ornament zhang-snow-ornament--left"
        data-testid="zhang-snow-ornament-left"
        draggable="false"
      />
      <img
        :src="snowPlumLanternUrl"
        alt=""
        class="zhang-snow-ornament zhang-snow-ornament--right"
        data-testid="zhang-snow-ornament-right"
        draggable="false"
      />
    </template>
    <img
      v-if="!zhangJuzheng"
      :src="calligraphyScrollUrl"
      alt=""
      class="ming-workspace-calligraphy"
      data-testid="ming-workspace-calligraphy"
      draggable="false"
    />
    <div
      v-else
      class="ming-workspace-calligraphy zhang-calligraphy-scroll"
      data-testid="ming-workspace-calligraphy"
    >
      <img
        :src="springCalligraphyScrollUrl"
        alt=""
        data-testid="zhang-calligraphy-scroll-image"
        draggable="false"
      />
    </div>
    <div class="ming-sidebar-scroll" data-testid="ming-sidebar-scroll">
      <img
        :src="zhangJuzheng ? wangweiStatusScrollUrl : statusScrollUrl"
        alt=""
        :data-testid="zhangJuzheng ? 'zhang-wangwei-scroll-image' : undefined"
        draggable="false"
      />
      <div v-if="!zhangJuzheng" class="ming-sidebar-scroll__copy">
        <strong>大明 · 星图</strong>
        <span>山河入卷 · 代码成章</span>
        <span>清风伴思 · 长夜有灯</span>
      </div>
      <span v-if="!zhangJuzheng" class="ming-sidebar-scroll__footer"> 千里江山，智在掌控 </span>
    </div>
    <div v-if="zhangJuzheng" class="zhang-juzheng-maxim" data-testid="zhang-juzheng-maxim">
      <strong>长风破浪会有时</strong>
      <span>直挂云帆济沧海</span>
      <small>为天下计</small>
    </div>
    <div v-if="zhangJuzheng" class="zhang-juzheng-vow" data-testid="zhang-juzheng-vow">
      <span>浩然之道</span>
      <span>在于坚守</span>
      <span>而不在于困顿</span>
    </div>
    <template v-if="zhangJuzheng">
      <div class="zhang-edge-scroll zhang-edge-scroll--top" data-testid="zhang-edge-scroll-top">
        <img
          :src="governanceCalligraphyScrollUrl"
          alt=""
          data-testid="zhang-edge-scroll-top-image"
          draggable="false"
        />
      </div>
      <div
        class="zhang-edge-scroll zhang-edge-scroll--bottom"
        data-testid="zhang-edge-scroll-bottom"
      >
        <img
          :src="ministerCalligraphyScrollUrl"
          alt=""
          data-testid="zhang-edge-scroll-bottom-image"
          draggable="false"
        />
      </div>
    </template>
  </div>
</template>
