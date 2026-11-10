<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Layers, Palette, PawPrint } from '@lucide/vue'
import Badge from '@renderer/components/ui/Badge.vue'

const props = defineProps<{
  title: string
  kind: 'theme' | 'pet' | 'action'
  kindLabel: string
  preview: string | null
  description?: string
  meta: string[]
  inUse?: boolean
  inUseLabel?: string
  progress?: string | null
}>()

const broken = ref(false)
watch(
  () => props.preview,
  () => {
    broken.value = false
  }
)

const icon = computed(() => (props.kind === 'theme' ? Palette : props.kind === 'pet' ? PawPrint : Layers))
</script>

<template>
  <article
    class="market-card flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border bg-[var(--bg-surface-raised)] transition-[border-color,box-shadow]"
    :class="
      inUse
        ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]'
        : 'border-[var(--border-subtle)] hover:border-[var(--border-default)]'
    "
  >
    <div class="market-card-preview relative" :data-kind="kind">
      <img
        v-if="preview && !broken"
        :src="preview"
        alt=""
        loading="lazy"
        class="size-full object-cover object-top"
        @error="broken = true"
      />
      <div
        v-else
        class="flex size-full items-center justify-center text-[var(--text-tertiary)]"
        data-testid="market-card-placeholder"
      >
        <component :is="icon" class="size-9 opacity-80" :stroke-width="1.25" />
      </div>
      <span
        v-if="inUse"
        class="absolute top-2 right-2 inline-flex h-5 items-center gap-1 rounded-full bg-[var(--accent)] px-2 text-[10px] font-medium text-[var(--text-on-accent,#fff)] shadow"
        data-testid="market-in-use"
      >
        <Check class="size-3" :stroke-width="2.5" />
        {{ inUseLabel }}
      </span>
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-1.5 border-t border-[var(--border-subtle)] p-3">
      <div class="flex min-w-0 items-center justify-between gap-2">
        <h2 class="truncate text-[13px] font-medium text-[var(--text-primary)]">{{ title }}</h2>
        <Badge :tone="kind === 'theme' ? 'accent' : 'muted'" class="shrink-0">{{ kindLabel }}</Badge>
      </div>
      <p
        v-if="description"
        class="line-clamp-2 text-[11.5px] leading-[1.45] text-[var(--text-secondary)]"
      >
        {{ description }}
      </p>
      <p class="text-[10.5px] text-[var(--text-tertiary)]">{{ meta.filter(Boolean).join(' · ') }}</p>
      <div v-if="progress" class="h-1 overflow-hidden rounded bg-[var(--bg-hover)]">
        <div class="h-full bg-[var(--accent)] transition-[width]" :style="{ width: progress }" />
      </div>
      <div class="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <slot name="actions" />
      </div>
      <slot />
    </div>
  </article>
</template>

<style scoped>
.market-card-preview {
  height: 148px;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 20% 10%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 60%),
    linear-gradient(160deg, var(--bg-surface), var(--bg-window));
}

.market-card-preview[data-kind='pet'],
.market-card-preview[data-kind='action'] {
  background:
    radial-gradient(120% 90% at 80% 10%, color-mix(in srgb, var(--success, var(--accent)) 24%, transparent), transparent 60%),
    linear-gradient(160deg, var(--bg-surface), var(--bg-window));
}
</style>
