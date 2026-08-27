<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import radarBaseImage from '@renderer/assets/themes/starship-cockpit/radar-base.png'

withDefaults(
  defineProps<{
    providerKey?: string | null
    modelId?: string | null
    thinkingLevel?: string | null
    totalTokens?: number | null
    messageCount?: number | null
    contextPercent?: number | null
    animated?: boolean
  }>(),
  {
    providerKey: null,
    modelId: null,
    thinkingLevel: null,
    totalTokens: null,
    messageCount: null,
    contextPercent: null,
    animated: true
  }
)

const pageVisible = ref(document.visibilityState === 'visible')

function syncVisibility(): void {
  pageVisible.value = document.visibilityState === 'visible'
}

onMounted(() => document.addEventListener('visibilitychange', syncVisibility))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', syncVisibility))

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return value.toLocaleString()
}
</script>

<template>
  <section
    v-if="providerKey || modelId"
    class="cockpit-only starship-model-hud"
    :aria-label="$t('overview.currentModel')"
    :data-animated="animated && pageVisible ? 'true' : 'false'"
  >
    <header class="starship-model-hud__header">
      <span>{{ $t('overview.currentModel') }}</span>
      <span>MODEL LINK</span>
    </header>
    <p class="starship-model-hud__model">
      {{ [providerKey, modelId].filter(Boolean).join('/') }}
    </p>
    <div class="starship-model-hud__radar" aria-hidden="true">
      <img :src="radarBaseImage" alt="" draggable="false" />
      <span class="starship-model-hud__sweep" />
      <span class="starship-model-hud__ping" />
    </div>
    <dl class="starship-model-hud__telemetry">
      <div v-if="totalTokens !== null">
        <dt>TOKEN</dt>
        <dd>{{ compactNumber(totalTokens) }}</dd>
      </div>
      <div v-if="messageCount !== null">
        <dt>{{ $t('workspace.messages') }}</dt>
        <dd>{{ compactNumber(messageCount) }}</dd>
      </div>
      <div v-if="contextPercent !== null">
        <dt>{{ $t('workspace.context') }}</dt>
        <dd>{{ Math.round(contextPercent) }}%</dd>
      </div>
      <div v-if="thinkingLevel">
        <dt>{{ $t('workspace.thinking') }}</dt>
        <dd>{{ thinkingLevel }}</dd>
      </div>
    </dl>
  </section>
</template>
