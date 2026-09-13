<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
    testId?: string
  }>(),
  {
    label: '',
    testId: 'local-loading-overlay'
  }
)
</script>

<template>
  <div
    class="absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-workspace)_76%,transparent)] backdrop-blur-[1px]"
    role="status"
    aria-live="polite"
    :data-testid="testId"
  >
    <div
      class="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 py-2 text-[11.5px] text-[var(--text-secondary)] shadow-[var(--shadow-popover)]"
    >
      <span
        aria-hidden="true"
        class="inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-[var(--accent)] border-r-transparent"
      />
      <span v-if="label">{{ label }}</span>
    </div>
  </div>
</template>
