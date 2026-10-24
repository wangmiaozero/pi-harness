<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileSearch } from '@lucide/vue'
import type { McpScanReport, McpScanCandidate, McpInventory } from '@shared/agent-settings/schema'
import { getApi } from '@renderer/composables/useApi'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import SettingsFeedback from './SettingsFeedback.vue'
const props = defineProps<{ root?: string; scanRoot?: string; inventory: McpInventory | null }>()
const emit = defineEmits<{ close: []; import: [candidate: McpScanCandidate] }>()
const { t } = useI18n()
const open = ref(true),
  busy = ref(false),
  error = ref(''),
  result = ref<McpScanReport | null>(null)
const installed = (id: string) => props.inventory?.entries.some((e) => e.id === id)
async function scan() {
  busy.value = true
  error.value = ''
  result.value = null
  try {
    result.value = await getApi().agentSettings.mcp.scan(
      (props.scanRoot ?? props.root) ? { root: props.scanRoot ?? props.root } : {}
    )
  } catch {
    error.value = t('mcpMarket.scanError')
  } finally {
    busy.value = false
  }
}
onMounted(scan)
</script>
<template>
  <Dialog :open="open" :title="t('mcpMarket.scan')" large @update:open="emit('close')">
    <div class="agent-settings feature-stack" data-testid="mcp-scan-results">
      <p class="feature-hint">{{ t('mcpMarket.scanHint') }}</p>
      <SettingsFeedback :busy="busy" :error="error" />
      <template v-if="result"
        ><div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div
            v-for="(source, index) in result.sources"
            :key="index"
            class="rounded-lg bg-[var(--bg-base)] p-3"
          >
            <div class="flex justify-between gap-2 text-xs">
              <strong>{{ source.name }}</strong
              ><span class="text-[var(--text-tertiary)]"
                >{{ t(`mcpMarket.sourceStatus.${source.status}`) }} · {{ source.count }}</span
              >
            </div>
            <p class="feature-hint mt-1 break-all font-mono">{{ source.path }}</p>
          </div>
        </div>
        <article
          v-for="candidate in result.candidates"
          :key="candidate.key"
          class="feature-card !mb-0 flex items-start gap-3"
        >
          <FileSearch class="mt-1 size-5 shrink-0 text-[var(--accent)]" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-semibold">{{ candidate.template.id }}</h3>
            <p class="feature-hint">{{ candidate.source }}</p>
            <code class="block break-all py-2 text-xs">{{
              candidate.template.url ||
              [candidate.template.command, ...(candidate.template.args ?? [])].join(' ')
            }}</code>
            <p v-if="candidate.blocked" class="feature-hint">
              {{ t('mcpMarket.credentialsHint') }}
            </p>
          </div>
          <Button
            size="sm"
            :disabled="installed(candidate.template.id)"
            @click="emit('import', candidate)"
            >{{
              t(installed(candidate.template.id) ? 'mcpMarket.installed' : 'mcpMarket.import')
            }}</Button
          >
        </article>
        <p v-if="!result.candidates.length" class="feature-hint py-5 text-center">
          {{ t('mcpMarket.scanEmpty') }}
        </p>
      </template>
      <div class="feature-actions justify-end">
        <Button :disabled="busy" @click="scan">{{ t('agentSettings.retry') }}</Button
        ><Button @click="emit('close')">{{ t('common.close') }}</Button>
      </div>
    </div>
  </Dialog>
</template>
