<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check } from '@lucide/vue'
import {
  CHATGPT_MODEL_ID,
  CHATGPT_MODEL_MODES,
  isSelectableChatGptModel,
  latestChatGptModels,
  orderChatGptModels,
  type ChatGptAccount,
  type ChatGptModelMode,
  type ChatGptModelPreferences
} from '@shared/providers/account-management'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'

const props = defineProps<{
  account: ChatGptAccount
  busy: boolean
  save: (input: ChatGptModelPreferences) => Promise<boolean>
}>()
const emit = defineEmits<{ focusModel: [id: string] }>()
const draft = ref<ChatGptModelPreferences | null>(null)
const typed = ref('')
const saved = computed<ChatGptModelPreferences>(() => ({
  id: props.account.id,
  mode: props.account.modelMode ?? 'catalog',
  modelIds: props.account.models.filter(isSelectableChatGptModel).map(({ id }) => id),
  addedModelIds: props.account.addedModelIds ?? [],
  routingOnly: props.account.routingOnly ?? false
}))
const current = computed(() => draft.value ?? saved.value)
const entries = computed(() => {
  const models = new Map(
    orderChatGptModels(props.account.models).map((item) => [
      item.id,
      { id: item.id, name: item.name, unsupported: item.unsupported }
    ])
  )
  for (const id of current.value.addedModelIds) {
    if (!models.has(id)) models.set(id, { id, name: id, unsupported: false })
  }
  return orderChatGptModels([...models.values()])
})
const available = computed(() => entries.value.filter((item) => !item.unsupported))
const selected = computed(() => {
  const { mode, modelIds } = current.value
  if (mode === 'usage') return new Set<string>()
  if (mode === 'latest') return new Set(latestChatGptModels(available.value).map(({ id }) => id))
  if (mode === 'catalog' && saved.value.mode !== 'catalog')
    return new Set(available.value.map(({ id }) => id))
  return new Set(modelIds)
})
const canAdd = computed(
  () =>
    CHATGPT_MODEL_ID.test(typed.value.trim()) &&
    !entries.value.some(({ id }) => id === typed.value.trim())
)

function changeMode(mode: ChatGptModelMode) {
  if (mode === current.value.mode) return
  draft.value = { ...current.value, mode, modelIds: [...selected.value] }
}

function choose(modelIds: string[]) {
  draft.value = { ...current.value, mode: modelIds.length ? 'selected' : 'usage', modelIds }
}

function toggle(id: string) {
  const ids = new Set(selected.value)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  choose([...ids])
  emit('focusModel', id)
}

function addModel() {
  if (!canAdd.value) return
  const id = typed.value.trim()
  draft.value = {
    ...current.value,
    mode: 'selected',
    addedModelIds: [...current.value.addedModelIds, id],
    modelIds: [...selected.value, id]
  }
  typed.value = ''
}

function removeAdded(id: string) {
  draft.value = {
    ...current.value,
    addedModelIds: current.value.addedModelIds.filter((item) => item !== id),
    modelIds: current.value.modelIds.filter((item) => item !== id)
  }
}

function reset() {
  draft.value = null
  typed.value = ''
}

async function commit() {
  const { id, mode, modelIds, addedModelIds, routingOnly } = current.value
  if (
    await props.save({
      id,
      mode,
      modelIds: [...modelIds],
      addedModelIds: [...addedModelIds],
      routingOnly
    })
  )
    reset()
}
</script>

<template>
  <fieldset
    class="space-y-2 rounded-lg border border-[var(--border-subtle)] px-3 pb-3"
    :disabled="busy"
    data-testid="chatgpt-model-preferences"
  >
    <legend class="px-1 text-xs font-medium">{{ $t('providerAccounts.modelSettings') }}</legend>
    <div class="flex flex-wrap gap-1.5">
      <Button
        v-for="mode in CHATGPT_MODEL_MODES"
        :key="mode"
        size="sm"
        :variant="current.mode === mode ? 'secondary' : 'ghost'"
        :aria-pressed="current.mode === mode"
        @click="changeMode(mode)"
      >
        {{ $t(`providerAccounts.modelMode.${mode}`) }}
      </Button>
    </div>
    <div class="flex flex-wrap gap-1.5">
      <Button
        size="sm"
        :disabled="!available.length"
        @click="choose(available.map(({ id }) => id))"
        >{{ $t('providerAccounts.selectAllModels') }}</Button
      >
      <Button size="sm" :disabled="!selected.size" @click="choose([])">{{
        $t('providerAccounts.selectNoModels')
      }}</Button>
    </div>
    <div class="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto py-0.5">
      <Button
        v-for="item in entries"
        :key="item.id"
        size="sm"
        variant="ghost"
        :aria-pressed="selected.has(item.id)"
        :disabled="item.unsupported"
        :title="item.unsupported ? $t('providerAccounts.modelUnsupported') : item.id"
        @click="toggle(item.id)"
      >
        <Check v-if="selected.has(item.id)" class="size-3" aria-hidden="true" />
        {{ item.name }}
      </Button>
    </div>
    <div class="flex flex-wrap items-end gap-2">
      <Input
        v-model="typed"
        class="min-w-48 flex-1"
        :label="$t('providerAccounts.addModelId')"
        @keydown.enter.prevent="addModel"
      />
      <Button size="sm" :disabled="!canAdd" @click="addModel">{{ $t('models.create') }}</Button>
    </div>
    <div v-if="current.addedModelIds.length" class="flex flex-wrap gap-1.5">
      <Button
        v-for="id in current.addedModelIds"
        :key="id"
        size="sm"
        variant="ghost"
        @click="removeAdded(id)"
        >{{ $t('providerAccounts.removeAddedModel', { id }) }}</Button
      >
    </div>
    <label class="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        :checked="current.routingOnly"
        @change="draft = { ...current, routingOnly: ($event.target as HTMLInputElement).checked }"
      />
      {{ $t('providerAccounts.routingOnly') }}
    </label>
    <p v-if="draft" class="text-xs text-[var(--text-secondary)]">
      {{ $t('providerAccounts.modelSelectionPending') }}
    </p>
    <div v-if="draft" class="flex justify-end gap-2">
      <Button size="sm" variant="ghost" @click="reset">{{ $t('common.cancel') }}</Button>
      <Button size="sm" variant="primary" @click="commit">{{ $t('common.save') }}</Button>
    </div>
  </fieldset>
</template>
