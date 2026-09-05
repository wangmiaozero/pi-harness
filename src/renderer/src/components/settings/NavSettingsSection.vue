<script setup lang="ts">
import { computed, inject } from 'vue'
import { RotateCcw } from '@lucide/vue'
import { DEFAULT_NAV_ORDER } from '@shared/constants/navigation'
import Button from '@renderer/components/ui/Button.vue'
import NavOrderList from '@renderer/components/settings/NavOrderList.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const draft = inject(SETTINGS_DRAFT_KEY)!

const navOrderIsDefault = computed(
  () =>
    draft.value.navOrder.length === DEFAULT_NAV_ORDER.length &&
    draft.value.navOrder.every((id, index) => id === DEFAULT_NAV_ORDER[index])
)

function resetNavOrder(): void {
  draft.value.navOrder = [...DEFAULT_NAV_ORDER]
}
</script>

<template>
  <section
    data-testid="nav-order-section"
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <div class="flex items-center justify-between gap-2 px-3 py-2">
      <p class="text-[11.5px] text-[var(--text-tertiary)]">{{ $t('settings.navOrderHint') }}</p>
      <Button
        variant="ghost"
        size="sm"
        :disabled="navOrderIsDefault"
        data-testid="nav-order-reset"
        @click="resetNavOrder"
      >
        <RotateCcw class="size-3" :stroke-width="1.75" />
        {{ $t('settings.navOrderReset') }}
      </Button>
    </div>
    <NavOrderList v-model="draft.navOrder" />
  </section>
</template>
