<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { InstructionDocument } from '@shared/agent-settings/schema'
import { getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import Button from '@renderer/components/ui/Button.vue'
import ScopePicker from './ScopePicker.vue'
import SettingsFeedback from './SettingsFeedback.vue'
import { useSettingsAction } from './useSettingsAction'
const { t } = useI18n()
const root = ref<string>(),
  document = ref<InstructionDocument | null>(null),
  content = ref('')
const { busy, error, message, run } = useSettingsAction()
const dirty = computed(() => document.value !== null && content.value !== document.value.content)
async function canLeave() {
  return (
    !dirty.value ||
    (await askConfirm({
      title: t('agentSettings.discard'),
      description: t('agentSettings.discardHint'),
      confirmLabel: t('agentSettings.remove'),
      tone: 'danger'
    }))
  )
}
const load = () =>
  run(async () => {
    const value = await getApi().agentSettings.instructions.read(
      root.value ? { root: root.value } : {}
    )
    document.value = value
    content.value = value.content
  })
async function reload() {
  if (await canLeave()) await load()
}
const save = () =>
  run(async () => {
    document.value = await getApi().agentSettings.instructions.save({
      ...(root.value ? { root: root.value } : {}),
      revision: document.value!.revision,
      content: content.value
    })
  }, true)
watch(root, () => {
  document.value = null
  void load()
})
onMounted(load)
onBeforeRouteLeave(canLeave)
</script>
<template>
  <div class="feature-stack">
    <ScopePicker v-model="root" :disabled="busy" :before-change="canLeave" />
    <SettingsFeedback :busy="busy" :error="error" :message="message" />
    <div class="feature-card">
      <h2>{{ t(root ? 'agentSettings.project' : 'agentSettings.global') }} · AGENTS.md</h2>
      <p class="feature-hint mb-2">
        {{
          t(root ? 'agentSettings.instructionsProjectHint' : 'agentSettings.instructionsGlobalHint')
        }}
      </p>
      <p v-if="document" class="feature-hint break-all mb-4 font-mono">{{ document.path }}</p>
      <textarea
        v-model="content"
        class="feature-textarea min-h-[360px]"
        :aria-label="t('agentSettings.instructions')"
        :disabled="busy || !document"
        spellcheck="false"
        maxlength="262144"
      />
      <div class="feature-actions mt-4">
        <Button variant="primary" :disabled="busy || !dirty" @click="save">{{
          t('agentSettings.save')
        }}</Button
        ><Button :disabled="busy" @click="reload">{{ t('agentSettings.reload') }}</Button
        ><span v-if="dirty" class="feature-hint">{{ t('agentSettings.unsaved') }}</span>
      </div>
    </div>
    <p class="feature-hint">{{ t('agentSettings.newSessionHint') }}</p>
  </div>
</template>
