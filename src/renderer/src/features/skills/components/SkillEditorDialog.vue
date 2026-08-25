<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import type { SkillInfo } from '@shared/ipc/api-types'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import Select from '@renderer/components/ui/Select.vue'
import { graphiteEditorTheme, graphiteSyntaxHighlighting } from '@renderer/styles/codemirror'
import type { SkillEditorFormState } from '@renderer/features/skills/types'

const props = defineProps<{
  open: boolean
  editing: SkillInfo | null
  form: SkillEditorFormState
  knownRoots: string[]
  busy: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:form': [value: SkillEditorFormState]
  save: []
}>()

const editorHost = ref<HTMLElement | null>(null)
let editorView: EditorView | null = null

const name = fieldModel('name')
const description = fieldModel('description')
const targetRoot = fieldModel('targetRoot')
const rootOptions = computed(() => props.knownRoots.map((root) => ({ value: root, label: root })))

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      destroyEditor()
      return
    }
    await nextTick()
    mountEditor(props.form.content)
  }
)

onBeforeUnmount(destroyEditor)

function fieldModel<Key extends 'name' | 'description' | 'targetRoot'>(key: Key) {
  return computed({
    get: () => props.form[key],
    set: (value: string) => emit('update:form', { ...props.form, [key]: value })
  })
}

function mountEditor(doc: string) {
  destroyEditor()
  if (!editorHost.value) return
  editorView = new EditorView({
    parent: editorHost.value,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        markdown(),
        graphiteEditorTheme,
        graphiteSyntaxHighlighting,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          emit('update:form', { ...props.form, content: update.state.doc.toString() })
        })
      ]
    })
  })
}

function destroyEditor() {
  editorView?.destroy()
  editorView = null
}
</script>

<template>
  <Dialog
    :open="open"
    wide
    :title="editing ? $t('skills.editTitle', { name: editing.name }) : $t('skills.createTitle')"
    :description="$t('skills.editorHint')"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-3">
        <Input
          v-model="name"
          :label="$t('skills.fieldName')"
          placeholder="my-skill"
          :disabled="!!editing"
        />
        <Select
          v-model="targetRoot"
          :label="$t('skills.fieldTargetRoot')"
          :options="rootOptions"
          :disabled="!!editing"
        />
      </div>
      <Input
        v-model="description"
        :label="$t('skills.fieldDescription')"
        :placeholder="$t('skills.fieldDescriptionPlaceholder')"
      />
      <div class="flex flex-col gap-1">
        <span class="text-[11.5px] font-medium text-[var(--text-secondary)]">SKILL.md</span>
        <div
          ref="editorHost"
          class="h-[42vh] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)]"
        />
      </div>
    </div>
    <template #footer>
      <Button variant="ghost" @click="emit('update:open', false)">{{ $t('common.cancel') }}</Button>
      <Button variant="primary" :loading="busy" @click="emit('save')">
        {{ $t('common.save') }}
      </Button>
    </template>
  </Dialog>
</template>
