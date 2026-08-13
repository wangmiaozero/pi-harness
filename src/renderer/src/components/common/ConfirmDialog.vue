<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Button from '@renderer/components/ui/Button.vue'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'

const { t } = useI18n()
const { state, resolveConfirm } = useConfirmDialog()

const open = computed({
  get: () => state.open,
  set: (v) => {
    if (!v) resolveConfirm(false)
  }
})

const confirmLabel = computed(() => state.confirmLabel || t('common.confirm'))
const cancelLabel = computed(() => state.cancelLabel || t('common.cancel'))
</script>

<template>
  <Dialog v-model:open="open" :title="state.title" :description="state.description || undefined">
    <template #footer>
      <Button variant="ghost" @click="resolveConfirm(false)">
        {{ cancelLabel }}
      </Button>
      <Button
        :variant="state.tone === 'danger' ? 'danger' : 'primary'"
        @click="resolveConfirm(true)"
      >
        {{ confirmLabel }}
      </Button>
    </template>
  </Dialog>
</template>
