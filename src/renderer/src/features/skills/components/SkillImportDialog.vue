<script setup lang="ts">
import { computed } from 'vue'
import { FileInput, FolderOpen } from '@lucide/vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import Select from '@renderer/components/ui/Select.vue'
import type { SkillImportFormState } from '@renderer/features/skills/types'

const props = defineProps<{
  open: boolean
  form: SkillImportFormState
  knownRoots: string[]
  busy: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:form': [value: SkillImportFormState]
  'pick-source': []
  submit: []
}>()

const source = fieldModel('source')
const name = fieldModel('name')
const targetRoot = fieldModel('targetRoot')
const rootOptions = computed(() => props.knownRoots.map((root) => ({ value: root, label: root })))

function fieldModel<Key extends keyof SkillImportFormState>(key: Key) {
  return computed({
    get: () => props.form[key],
    set: (value: string) => emit('update:form', { ...props.form, [key]: value })
  })
}
</script>

<template>
  <Dialog
    :open="open"
    :title="$t('skills.importTitle')"
    :description="$t('skills.importHint')"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <Input
        v-model="source"
        :label="$t('skills.importSource')"
        :placeholder="$t('skills.importSourcePlaceholder')"
      />
      <Button variant="secondary" size="sm" @click="emit('pick-source')">
        <FolderOpen class="size-3.5" :stroke-width="1.75" />
        {{ $t('skills.pickImportSource') }}
      </Button>
      <Input
        v-model="name"
        :label="$t('skills.fieldName')"
        :placeholder="$t('skills.importNamePlaceholder')"
      />
      <Select v-model="targetRoot" :label="$t('skills.fieldTargetRoot')" :options="rootOptions" />
    </div>
    <template #footer>
      <Button variant="ghost" @click="emit('update:open', false)">{{ $t('common.cancel') }}</Button>
      <Button variant="primary" :loading="busy" @click="emit('submit')">
        <FileInput class="size-3.5" :stroke-width="1.75" />
        {{ $t('skills.import') }}
      </Button>
    </template>
  </Dialog>
</template>
