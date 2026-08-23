<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { MascotStyle } from '@shared/constants/mascot'
import { PET_STATES, type PetState } from '@shared/pet/types'
import { usePetStore } from '@renderer/stores/pet'
import { getPetManifest } from '@renderer/pet/manifests'
import PetRenderer from './PetRenderer.vue'

const props = defineProps<{ style: MascotStyle }>()
const pet = usePetStore()
const { debugSnapshot } = storeToRefs(pet)
const previewState = ref<PetState>('idle')
const manifest = computed(() => getPetManifest(props.style) ?? getPetManifest('maidWhite'))
</script>

<template>
  <div class="border-t border-[var(--border-subtle)] p-3" data-testid="pet-debug-preview">
    <div class="mb-2 text-[11px] font-medium text-[var(--text-secondary)]">
      {{ $t('pet.debugTitle') }}
    </div>
    <div class="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
      <PetRenderer v-if="manifest" :manifest="manifest" :state="previewState" variant="preview" />
      <div class="min-w-0">
        <div class="mb-2 flex flex-wrap gap-1">
          <button
            v-for="item in PET_STATES"
            :key="item"
            type="button"
            class="rounded border border-[var(--border-subtle)] px-1.5 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            :class="
              previewState === item ? 'border-[var(--accent-border)] text-[var(--accent)]' : ''
            "
            @click="previewState = item"
          >
            {{ item }}
          </button>
        </div>
        <pre class="max-h-28 overflow-auto text-[9.5px] leading-4 text-[var(--text-tertiary)]">{{
          JSON.stringify(debugSnapshot, null, 2)
        }}</pre>
      </div>
    </div>
  </div>
</template>
