<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { FolderOpen } from '@lucide/vue'
import Button from '@renderer/components/ui/Button.vue'
import { getApi } from '@renderer/composables/useApi'
import { useSettingsAction } from './useSettingsAction'
import SettingsFeedback from './SettingsFeedback.vue'
const root = defineModel<string | undefined>()
const props = defineProps<{ disabled?: boolean; beforeChange?: () => Promise<boolean> }>()
const { t } = useI18n()
const { busy, error, run } = useSettingsAction()
async function choose() {
  if (props.beforeChange && !(await props.beforeChange())) return
  await run(async () => {
    const selected = await getApi().workspace.pickDirectory()
    if (selected) root.value = selected
  })
}
async function global() {
  if (!props.beforeChange || (await props.beforeChange())) root.value = undefined
}
</script>
<template>
  <div class="feature-actions">
    <Button
      :variant="!root ? 'primary' : 'secondary'"
      :disabled="disabled || busy"
      @click="global"
      >{{ t('agentSettings.global') }}</Button
    >
    <Button :variant="root ? 'primary' : 'secondary'" :disabled="disabled || busy" @click="choose"
      ><FolderOpen class="size-3.5" />{{
        root ? t('agentSettings.project') : t('agentSettings.chooseProject')
      }}</Button
    >
    <span v-if="root" class="feature-hint min-w-0 truncate" :title="root">{{ root }}</span>
    <SettingsFeedback :error="error" />
  </div>
</template>
