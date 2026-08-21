<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

defineProps<{
  title: string
  description?: string
  wide?: boolean
}>()

const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[100] bg-black/45 data-[state=open]:animate-[pi-fade-in_var(--motion-base)_var(--ease-out)] data-[state=closed]:animate-[pi-fade-in_var(--motion-base)_var(--ease-out)_reverse]"
      />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-[101] flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] shadow-[var(--shadow-dialog)] focus:outline-none data-[state=open]:animate-[pi-pop-in_var(--motion-base)_var(--ease-out)]"
        :class="wide ? 'w-[min(560px,92vw)]' : 'w-[min(420px,92vw)]'"
      >
        <div class="flex shrink-0 items-start justify-between gap-3 px-4 pb-3 pt-4">
          <div class="min-w-0">
            <DialogTitle class="text-[14px] font-semibold text-[var(--text-primary)]">
              {{ title }}
            </DialogTitle>
            <p v-if="description" class="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              {{ description }}
            </p>
          </div>
          <DialogClose
            class="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            :aria-label="t('common.close')"
          >
            <X class="size-3" aria-hidden="true" :stroke-width="1.75" />
          </DialogClose>
        </div>
        <div v-if="$slots.default" class="overflow-y-auto px-4 pb-4">
          <slot />
        </div>
        <footer
          v-if="$slots.footer"
          class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-4 py-3"
        >
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
