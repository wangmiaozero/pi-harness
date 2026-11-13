<script setup lang="ts">
import { ref } from 'vue'
import { getErrorPayload } from '@renderer/composables/useApi'
import type { ConnectionTestResult } from '@shared/ipc/api-types'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'

const props = defineProps<{
  model: string
  hint: string
  run: () => Promise<ConnectionTestResult | void>
}>()
const emit = defineEmits<{ close: [] }>()
const running = ref(false)
const result = ref<{ ok: boolean; message?: string; reason?: string; status?: number } | null>(null)

async function executeTest() {
  if (running.value || result.value) return
  running.value = true
  try {
    const test = await props.run()
    result.value = test
      ? {
          ok: test.ok,
          message: test.ok ? undefined : test.message,
          status: test.httpStatus ?? undefined
        }
      : { ok: true }
  } catch (error) {
    const payload = getErrorPayload(error)
    const details = payload.details as { reason?: string; status?: number } | undefined
    const reason = details?.reason
    result.value = {
      ok: false,
      reason:
        reason && ['timeout', 'network', 'response', 'http'].includes(reason) ? reason : undefined,
      status: details?.status,
      message: payload.message
    }
  } finally {
    running.value = false
  }
}
</script>

<template>
  <Dialog
    :open="true"
    :title="$t('providerAccounts.verify')"
    @update:open="
      (open) => {
        if (!open && !running) emit('close')
      }
    "
  >
    <p class="mb-2 text-sm font-medium">{{ model }}</p>
    <p v-if="running" role="status" class="text-sm">{{ $t('providerAccounts.testRunning') }}</p>
    <template v-else-if="result">
      <p :role="result.ok ? 'status' : 'alert'" class="text-sm font-semibold">
        {{ $t(result.ok ? 'providerAccounts.testSuccess' : 'providerAccounts.testFailure') }}
      </p>
      <p v-if="!result.ok" class="mt-1 text-sm text-[var(--text-secondary)]">
        {{
          result.reason
            ? $t(`providerAccounts.testProblem.${result.reason}`, { status: result.status })
            : result.message
        }}
        <span v-if="result.status && result.reason !== 'http'"> (HTTP {{ result.status }})</span>
      </p>
    </template>
    <p v-else class="text-sm">{{ hint }}</p>
    <template #footer>
      <Button size="sm" :disabled="running" @click="emit('close')">
        {{ $t(result ? 'common.close' : 'common.cancel') }}
      </Button>
      <Button v-if="!result" size="sm" variant="primary" :loading="running" @click="executeTest">
        {{ $t('providerAccounts.confirm') }}
      </Button>
    </template>
  </Dialog>
</template>
