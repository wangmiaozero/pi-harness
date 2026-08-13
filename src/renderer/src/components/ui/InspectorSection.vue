<script setup lang="ts">
/* macOS Inspector section. Section header + body, no Card chrome. The
 * surrounding surface supplies the background; we add a subtle hairline at
 * the top of every section after the first. */
</script>

<template>
  <section class="flex flex-col">
    <header
      v-if="$slots.title || $slots.actions"
      class="flex items-center justify-between gap-2 px-3 h-[30px]"
    >
      <h3
        v-if="$slots.title"
        class="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
      >
        <slot name="title" />
      </h3>
      <div v-else class="flex-1" />
      <div v-if="$slots.actions" class="flex items-center gap-1">
        <slot name="actions" />
      </div>
    </header>
    <div class="flex flex-col">
      <slot />
    </div>
  </section>
</template>
