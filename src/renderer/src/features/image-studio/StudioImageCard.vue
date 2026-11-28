<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { Download, ImagePlus, Trash2 } from '@lucide/vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import type { StudioImage } from './library'
import { imageDownloadName } from './image-files'

const props = defineProps<{ work: StudioImage }>()
const emit = defineEmits<{ preview: []; reference: []; remove: [] }>()
const url = URL.createObjectURL(props.work.image)
const filename = imageDownloadName(props.work.modelId, props.work.createdAt, props.work.image.type)
onBeforeUnmount(() => URL.revokeObjectURL(url))
</script>

<template>
  <article class="image-card" data-testid="studio-image">
    <button
      type="button"
      class="image-card__preview"
      :aria-label="$t('models.imageResult')"
      @click="emit('preview')"
    >
      <img :src="url" :alt="work.prompt" loading="lazy" />
    </button>
    <p class="image-card__prompt" :title="work.prompt">{{ work.prompt }}</p>
    <div class="image-card__actions">
      <span class="image-card__model" :title="work.fallbackModelId ?? work.modelId">
        {{ work.fallbackModelId ?? work.modelId }}
      </span>
      <IconButton :label="$t('imageStudio.useAsReference')" @click="emit('reference')">
        <ImagePlus class="size-4" />
      </IconButton>
      <a
        :href="url"
        :download="filename"
        :aria-label="$t('models.imageDownload')"
        :title="$t('models.imageDownload')"
      >
        <Download class="size-4" />
      </a>
      <IconButton :label="$t('common.delete')" @click="emit('remove')">
        <Trash2 class="size-4" />
      </IconButton>
    </div>
  </article>
</template>

<style scoped>
.image-card {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}
.image-card__preview {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--bg-surface-raised);
}
.image-card__preview:hover img {
  transform: scale(1.015);
}
.image-card__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 180ms var(--ease-out);
}
.image-card__prompt {
  overflow: hidden;
  margin: 11px 12px 2px;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 550;
}
.image-card__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px 7px 12px;
}
.image-card__model {
  flex: 1;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-card__actions a {
  display: grid;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
.image-card__actions a:hover {
  background: var(--bg-hover);
}
@media (prefers-reduced-motion: reduce) {
  .image-card__preview img {
    transition: none;
  }
}
</style>
