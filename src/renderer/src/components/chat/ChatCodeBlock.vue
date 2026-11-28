<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Check, Copy } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import IconButton from '@renderer/components/ui/IconButton.vue'
import { callApi, getApi } from '@renderer/composables/useApi'

defineOptions({ inheritAttrs: false })

const { t } = useI18n()
const code = ref<HTMLPreElement | null>(null)
const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  const text = code.value?.textContent
  if (!text) return
  try {
    await callApi(() => getApi().system.copyText(text))
  } catch {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      toast.error(t('diagnostics.copyFailed'))
      return
    }
  }
  if (!code.value) return
  copied.value = true
  clearTimeout(resetTimer)
  resetTimer = setTimeout(() => (copied.value = false), 1500)
}

onBeforeUnmount(() => clearTimeout(resetTimer))
</script>

<template>
  <div class="chat-code-block relative">
    <pre ref="code" v-bind="$attrs"><slot /></pre>
    <IconButton
      class="absolute right-2 bottom-2"
      :label="t('workspace.copyCode')"
      :title="copied ? t('diagnostics.copied') : t('workspace.copyCode')"
      data-testid="copy-message-code"
      @click="copy"
    >
      <Check v-if="copied" aria-hidden="true" class="size-3.5" />
      <Copy v-else aria-hidden="true" class="size-3.5" />
    </IconButton>
    <span role="status" class="sr-only">{{ copied ? t('diagnostics.copied') : '' }}</span>
  </div>
</template>
