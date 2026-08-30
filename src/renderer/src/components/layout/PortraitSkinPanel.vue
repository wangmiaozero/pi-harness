<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MascotStyle } from '@shared/constants/mascot'
import { getPetManifest } from '@renderer/pet/manifests'
import { usePetStore } from '@renderer/stores/pet'
import PetStatus from '@renderer/components/pet/PetStatus.vue'

const props = defineProps<{ style: MascotStyle; showStatus: boolean }>()
const pet = usePetStore()
const manifest = computed(() => getPetManifest(props.style))
const labelKey = computed(
  () => `settings.mascot${props.style[0].toUpperCase()}${props.style.slice(1)}`
)
const failed = ref(false)
watch(
  () => props.style,
  () => {
    failed.value = false
  }
)
</script>

<template>
  <aside
    v-if="manifest"
    data-testid="portrait-skin-panel"
    :data-style="style"
    class="portrait-skin-panel pointer-events-none select-none"
    aria-hidden="true"
  >
    <div class="portrait-skin-heading">
      <span class="portrait-skin-rule" />
      <span>{{ $t(labelKey) }}</span>
      <span class="portrait-skin-rule" />
    </div>
    <div class="portrait-skin-character">
      <div class="portrait-skin-artwork">
        <img
          v-if="!failed"
          :src="manifest.sprite"
          data-testid="portrait-skin-image"
          alt=""
          draggable="false"
          @error="failed = true"
        />
        <span v-else class="portrait-skin-fallback">π</span>
      </div>
      <div class="portrait-skin-footer">
        <PetStatus v-if="showStatus" :state="pet.state" :current-tool="pet.currentTool" />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.portrait-skin-panel {
  display: flex;
  flex: 0 0 32%;
  min-width: 0;
  max-width: 440px;
  flex-direction: column;
  padding: 20px 12px 12px;
  border-right: 1px solid var(--border-subtle);
  background: var(--portrait-panel-background);
}

.portrait-skin-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 11px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.portrait-skin-rule {
  height: 1px;
  flex: 1;
  background: var(--accent-border);
}

.portrait-skin-artwork {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  padding-block: 16px;
}

.portrait-skin-character {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.portrait-skin-artwork img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* Preserve the supplied full image, including its original background. */
  filter: none;
  mask-image: none;
}

.portrait-skin-fallback {
  color: var(--accent);
  font: 32px var(--font-mono);
}

.portrait-skin-footer {
  display: flex;
  min-height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

/* Leave room for actual work when the editor or a narrow window needs it. */
@container (max-width: 820px) {
  .portrait-skin-panel {
    display: none;
  }
}
</style>
