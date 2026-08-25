<script setup lang="ts">
import type { PiPackageInfo, SkillInfo } from '@shared/ipc/api-types'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Button from '@renderer/components/ui/Button.vue'

defineProps<{
  deleteOpen: boolean
  deleting: SkillInfo | null
  packageRemoveOpen: boolean
  removingPackage: PiPackageInfo | null
  packageRemoveBusy: boolean
}>()

const emit = defineEmits<{
  'update:deleteOpen': [value: boolean]
  'update:packageRemoveOpen': [value: boolean]
  confirmDelete: []
  confirmPackageRemove: []
}>()
</script>

<template>
  <Dialog
    :open="deleteOpen"
    :title="$t('skills.deleteConfirm')"
    :description="$t('skills.deleteHint')"
    @update:open="emit('update:deleteOpen', $event)"
  >
    <p
      class="mb-4 break-all font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]"
    >
      {{ deleting?.path }}
    </p>
    <template #footer>
      <Button variant="ghost" size="sm" @click="emit('update:deleteOpen', false)">
        {{ $t('common.cancel') }}
      </Button>
      <Button variant="danger" size="sm" @click="emit('confirmDelete')">
        {{ $t('skills.uninstallSkill') }}
      </Button>
    </template>
  </Dialog>

  <Dialog
    :open="packageRemoveOpen"
    :title="$t('skills.removePackageTitle')"
    :description="$t('skills.removePackageHint')"
    @update:open="emit('update:packageRemoveOpen', $event)"
  >
    <p
      class="mb-4 break-all font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]"
    >
      {{ removingPackage?.source }}
    </p>
    <template #footer>
      <Button variant="ghost" size="sm" @click="emit('update:packageRemoveOpen', false)">
        {{ $t('common.cancel') }}
      </Button>
      <Button
        variant="danger"
        size="sm"
        :loading="packageRemoveBusy"
        @click="emit('confirmPackageRemove')"
      >
        {{ $t('skills.removePackage') }}
      </Button>
    </template>
  </Dialog>
</template>
