<script setup lang="ts">
import { Folder, FolderPlus, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import type { WorkspaceFolder } from '@shared/types/workspace'

defineProps<{
  folders: WorkspaceFolder[]
  saving?: boolean
}>()

const emit = defineEmits<{
  add: []
  remove: [folder: WorkspaceFolder]
  save: []
}>()

const open = defineModel<boolean>('open', { default: false })
const name = defineModel<string>('name', { default: '' })
const { t } = useI18n()
</script>

<template>
  <Dialog v-model:open="open" medium prominent-title :title="t('workspace.editProjects')">
    <div class="space-y-3" data-testid="session-workspace-editor">
      <div
        class="flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3"
      >
        <Folder class="size-4 shrink-0 text-[var(--text-secondary)]" :stroke-width="1.7" />
        <input
          v-model="name"
          maxlength="256"
          :disabled="saving"
          :aria-label="t('workspace.projectName')"
          class="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--text-primary)] outline-none"
        />
      </div>

      <section aria-labelledby="session-workspace-folders-label">
        <p
          id="session-workspace-folders-label"
          class="mb-1.5 text-[11.5px] font-medium text-[var(--text-secondary)]"
        >
          {{ t('workspace.sourceFolders') }}
        </p>
        <div
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)]"
        >
          <div
            v-for="(folder, index) in folders"
            :key="folder.id"
            :data-testid="`session-workspace-folder-${index}`"
            class="flex min-h-11 items-center gap-2 border-b border-[var(--border-subtle)] px-3 last:border-b-0"
          >
            <Folder class="size-4 shrink-0 text-[var(--text-secondary)]" :stroke-width="1.7" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-[12.5px] text-[var(--text-primary)]">{{ folder.name }}</p>
            </div>
            <span
              v-if="index === 0"
              class="rounded-full border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 py-0.5 text-[9.5px] text-[var(--text-secondary)]"
            >
              {{ t('workspace.primaryProject') }}
            </span>
            <button
              type="button"
              class="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--error-tint)] hover:text-[var(--error)] disabled:pointer-events-none disabled:opacity-25"
              :disabled="index === 0 || saving"
              :title="t('workspace.removeFolder')"
              :aria-label="`${t('workspace.removeFolder')}: ${folder.name}`"
              @click="emit('remove', folder)"
            >
              <X class="size-3.5" :stroke-width="1.75" />
            </button>
          </div>

          <button
            type="button"
            :disabled="saving"
            data-testid="session-workspace-add-folder"
            class="flex h-11 w-full items-center gap-2 px-3 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            @click="emit('add')"
          >
            <FolderPlus class="size-4 shrink-0" :stroke-width="1.7" />
            <span>{{ t('workspace.addSourceFolder') }}</span>
          </button>
        </div>
      </section>
      <p class="text-[11.5px] text-[var(--text-tertiary)]">
        {{ t('workspace.projectSourcesHint') }}
      </p>
    </div>

    <template #footer>
      <Button variant="ghost" :disabled="saving" @click="open = false">
        {{ t('common.cancel') }}
      </Button>
      <Button
        variant="primary"
        :loading="saving"
        :disabled="folders.length === 0 || !name.trim()"
        data-testid="session-workspace-save"
        @click="emit('save')"
      >
        {{ t('common.save') }}
      </Button>
    </template>
  </Dialog>
</template>
