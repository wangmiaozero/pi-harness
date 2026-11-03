<script setup lang="ts">
import { computed, inject } from 'vue'
import { RotateCcw } from '@lucide/vue'
import {
  normalizeNavOrder,
  OVERFLOW_NAV_ITEM_IDS,
  type NavItemId
} from '@shared/constants/navigation'
import Button from '@renderer/components/ui/Button.vue'
import NavOrderList from '@renderer/components/settings/NavOrderList.vue'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const draft = inject(SETTINGS_DRAFT_KEY)!

const overflowOrder = computed({
  get: () =>
    normalizeNavOrder(draft.value.navOrder).filter((id) => OVERFLOW_NAV_ITEM_IDS.includes(id)),
  set: (value: NavItemId[]) => {
    let index = 0
    draft.value.navOrder = normalizeNavOrder(draft.value.navOrder).map((id) =>
      OVERFLOW_NAV_ITEM_IDS.includes(id) ? value[index++]! : id
    )
  }
})
const navOrderIsDefault = computed(() =>
  overflowOrder.value.every((id, index) => id === OVERFLOW_NAV_ITEM_IDS[index])
)
function resetNavOrder(): void {
  overflowOrder.value = [...OVERFLOW_NAV_ITEM_IDS]
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
    <NavOrderList v-model="overflowOrder" />
  </section>
</template>
