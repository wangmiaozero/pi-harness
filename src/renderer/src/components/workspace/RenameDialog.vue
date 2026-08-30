<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ref } from 'vue'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Input from '@renderer/components/ui/Input.vue'

defineProps<{ title: string; saving: boolean }>()
const emit = defineEmits<{ save: [] }>()
const open = defineModel<boolean>('open', { default: false })
const name = defineModel<string>('name', { default: '' })
const { t } = useI18n()
const form = ref<HTMLFormElement | null>(null)

function focusName(event: Event) {
  event.preventDefault()
  form.value?.querySelector('input')?.focus()
}

function selectName(event: FocusEvent) {
  ;(event.target as HTMLInputElement).select()
}
</script>

<template>
  <Dialog
    v-model:open="open"
    medium
    prominent-title
    :title="title"
    :description="t('workspace.renameHint')"
    @open-auto-focus="focusName"
  >
    <form id="workspace-rename-form" ref="form" class="pb-3 pt-1" @submit.prevent="emit('save')">
      <Input
        v-model="name"
        :aria-label="title"
        maxlength="256"
        :disabled="saving"
        data-testid="workspace-rename-input"
        @focus="selectName"
      />
    </form>
    <template #footer>
      <Button variant="secondary" :disabled="saving" @click="open = false">
        <span>{{ t('common.cancel') }}</span>
      </Button>
      <Button
        variant="primary"
        type="submit"
        form="workspace-rename-form"
        :disabled="!name.trim()"
        :loading="saving"
        data-testid="workspace-rename-save"
      >
        <span>{{ t('common.save') }}</span>
      </Button>
    </template>
  </Dialog>
</template>
