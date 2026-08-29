<script setup lang="ts">
import { computed, inject } from 'vue'
import { ChevronDown, ChevronRight, File, Folder } from '@lucide/vue'
import type { FileTreeEntry } from '@shared/types/workspace'
import { FILE_TREE_API, type FileTreeApi } from './file-tree-api'

defineOptions({ name: 'FileTreeNode' })

const props = defineProps<{ entry: FileTreeEntry }>()
const tree = inject<FileTreeApi>(FILE_TREE_API)
if (!tree) throw new Error('FileTreeNode requires FileExplorer')

const expanded = computed(() => tree.isExpanded(props.entry.path))
const children = computed(() => tree.childrenOf(props.entry.path))
</script>

<template>
  <li>
    <button
      type="button"
      class="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      @click="tree.openEntry(entry)"
    >
      <ChevronDown
        v-if="entry.isDirectory && expanded"
        class="size-3 shrink-0"
        :stroke-width="1.75"
      />
      <ChevronRight
        v-else-if="entry.isDirectory"
        class="size-3 shrink-0"
        :stroke-width="1.75"
      />
      <Folder v-if="entry.isDirectory" class="size-3.5 shrink-0" :stroke-width="1.75" />
      <File v-else class="size-3.5 shrink-0" :stroke-width="1.75" />
      <span class="truncate">{{ entry.name }}</span>
    </button>
    <ul v-if="entry.isDirectory && expanded" class="ml-4">
      <FileTreeNode v-for="child in children" :key="child.path" :entry="child" />
    </ul>
  </li>
</template>
