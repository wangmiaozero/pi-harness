<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { ConnectionTestResult } from '@shared/ipc/api-types'
import { getApi } from '@renderer/composables/useApi'
import Badge from '@renderer/components/ui/Badge.vue'
import Button from '@renderer/components/ui/Button.vue'

const props = defineProps<{ result: ConnectionTestResult }>()
const { t } = useI18n()
const transports = {
  node_fetch: 'Node Fetch',
  electron_fetch: 'Electron Fetch',
  responses_websocket: 'Responses WebSocket'
}
const transport = computed(() =>
  props.result.network?.transport
    ? transports[props.result.network.transport]
    : t('providerDiagnostics.notStarted')
)
const details = computed<readonly (readonly [string, string | null | undefined])[]>(() => [
  [t('providers.testStatus'), props.result.status],
  [t('providerDiagnostics.provider'), props.result.providerKey],
  [t('providers.testEndpoint'), props.result.endpoint],
  [t('providers.testProtocol'), props.result.protocol],
  [t('providers.testModel'), props.result.modelId],
  [t('providerDiagnostics.route'), props.result.network?.proxyRoute],
  [t('providerDiagnostics.code'), props.result.errorCode]
])

async function copy() {
  try {
    await getApi().system.copyText(JSON.stringify(props.result, null, 2))
    toast.success(t('diagnostics.copied'))
  } catch {
    toast.error(t('common.failed'))
  }
}
</script>

<template>
  <div
    data-testid="provider-connection-diagnostics"
    class="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5"
  >
    <div class="flex flex-wrap items-center gap-1.5">
      <Badge
        v-if="result.status !== 'cancelled'"
        :tone="result.ok ? 'success' : result.status === 'rate_limited' ? 'warning' : 'error'"
      >
        {{
          result.ok
            ? t('providers.testSuccess')
            : result.status === 'rate_limited'
              ? t('providers.testRateLimited')
              : result.status === 'auth_error' && result.httpStatus === 401
                ? t('providers.testUnauthorized')
                : result.status === 'forbidden'
                  ? t('providers.testForbidden')
                  : t('providers.testFailed')
        }}
      </Badge>
      <Badge v-if="result.httpStatus != null" tone="muted">HTTP {{ result.httpStatus }}</Badge>
      <span class="text-xs text-[var(--text-secondary)]">{{ result.latencyMs }} ms</span>
      <span v-if="result.network" class="text-xs text-[var(--text-secondary)]">
        {{ t(`providerDiagnostics.modes.${result.network.proxyMode}`) }}
        <template v-if="result.network.automaticProxySource">
          · {{ t(`providerDiagnostics.sources.${result.network.automaticProxySource}`) }}
        </template>
        · {{ transport }}
      </span>
    </div>
    <p class="text-xs text-[var(--text-secondary)]">
      {{ t(`providerDiagnostics.hints.${result.status}`) }}
    </p>
    <p v-if="result.upstreamError?.parameter" class="text-xs text-[var(--text-secondary)]">
      {{ t('providerDiagnostics.upstreamParameter') }} ·
      <code>{{ result.upstreamError.parameter }}</code>
    </p>
    <details class="text-xs">
      <summary class="cursor-pointer">{{ t('providerDiagnostics.details') }}</summary>
      <p v-if="result.network?.proxyMode === 'auto'" class="mt-2 text-[var(--text-secondary)]">
        {{ t('providerDiagnostics.autoHint') }}
      </p>
      <dl class="mt-2 grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
        <template v-for="[label, value] in details" :key="label">
          <dt class="text-[var(--text-tertiary)]">{{ label }}</dt>
          <dd class="break-all font-[family-name:var(--font-mono)]">{{ value ?? '—' }}</dd>
        </template>
      </dl>
      <p v-if="result.upstreamError?.code" class="mt-2 text-[var(--text-secondary)]">
        {{ t('providerDiagnostics.upstreamCode') }} · <code>{{ result.upstreamError.code }}</code>
      </p>
      <Button class="mt-2" size="sm" @click="copy">{{ t('providerDiagnostics.copy') }}</Button>
    </details>
  </div>
</template>
