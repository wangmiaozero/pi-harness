<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApi } from '@renderer/composables/useApi'
import type { RuntimeDiagnostics, RuntimeKind, RuntimeSelection } from '@shared/runtime/schema'
import type { EnvironmentInstallTask } from '@shared/ipc/api-types'
import Button from '@renderer/components/ui/Button.vue'
import Select from '@renderer/components/ui/Select.vue'
import Input from '@renderer/components/ui/Input.vue'
import EnvironmentTaskProgress from '@renderer/components/environment/EnvironmentTaskProgress.vue'

const { api } = useApi()
const { t } = useI18n()
const diagnostics = ref<RuntimeDiagnostics | null>(null)
const selected = reactive<Record<RuntimeKind, RuntimeSelection>>({
  pi: { source: 'bundled' },
  node: { source: 'bundled' }
})
const busy = ref(false)
const message = ref('')
const error = ref('')
const task = ref<EnvironmentInstallTask | null>(null)
const kinds: RuntimeKind[] = ['pi', 'node']
const options = computed(() =>
  ['bundled', 'system', 'custom'].map((source) => ({
    value: source,
    label: t(`runtime.${source}`)
  }))
)
let unsubscribe: (() => void) | undefined
function sync(value: RuntimeDiagnostics): void {
  diagnostics.value = value
  for (const kind of kinds) selected[kind] = { ...value.configuration[kind] }
}
async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await action()
  } catch (cause) {
    error.value =
      (cause as { userMessage?: string; message?: string }).userMessage ?? (cause as Error).message
  } finally {
    busy.value = false
  }
}
async function refresh(): Promise<void> {
  await run(async () => sync(await api.runtimes.diagnostics()))
}
async function apply(kind: RuntimeKind): Promise<void> {
  await run(async () => {
    sync(await api.runtimes.switch(kind, selected[kind]))
    message.value = t('runtime.saved')
  })
}
async function choose(kind: RuntimeKind): Promise<void> {
  await run(async () => {
    const file = await api.runtimes.pick(kind)
    if (file) selected[kind].customPath = file
  })
}
async function maintain(
  kind: RuntimeKind,
  operation: 'verify' | 'update' | 'rollback'
): Promise<void> {
  await run(async () => sync(await api.runtimes[operation](kind)))
}
async function check(): Promise<void> {
  await run(async () => {
    const result = await api.runtimes.checkUpdates()
    message.value = t('runtime.updates', { pi: result.pi.available, node: result.node.available })
  })
}
onMounted(() => {
  unsubscribe = api.on('environment-install-task', (value) => {
    task.value = value as EnvironmentInstallTask
  })
  void refresh()
})
onUnmounted(() => unsubscribe?.())
</script>

<template>
  <section data-testid="runtime-settings" class="space-y-3 p-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-[13px] font-medium">{{ t('runtime.title') }}</h3>
      <Button size="sm" :disabled="busy" @click="refresh">{{ t('runtime.refresh') }}</Button>
    </div>
    <p class="text-[11px] text-[var(--text-secondary)]">{{ t('runtime.sessionHint') }}</p>
    <p v-if="diagnostics?.compatibilityMode" class="text-[11px] text-[var(--warning)]">
      {{ t('runtime.compatibility') }}
    </p>
    <p v-if="diagnostics?.activeSessions" class="text-[11px] text-[var(--warning)]">
      {{ t('runtime.active', { count: diagnostics.activeSessions }) }}
    </p>
    <div
      v-for="kind in kinds"
      :key="kind"
      :data-testid="`runtime-${kind}`"
      class="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-3"
    >
      <div class="flex items-center justify-between">
        <h4 class="text-[12px] font-medium">{{ t(`runtime.${kind}`) }}</h4>
        <span
          v-if="diagnostics"
          class="text-[11px]"
          :class="diagnostics[kind].valid ? 'text-[var(--success)]' : 'text-[var(--error)]'"
          >{{ t(diagnostics[kind].valid ? 'runtime.ready' : 'runtime.unavailable') }}</span
        >
      </div>
      <Select
        v-model="selected[kind].source"
        :label="t('runtime.source')"
        :options="options"
        :disabled="busy"
      />
      <template v-if="selected[kind].source === 'custom'">
        <Input v-model="selected[kind].customPath" :label="t('runtime.path')" mono readonly />
        <Button size="sm" :disabled="busy" @click="choose(kind)">{{ t('runtime.browse') }}</Button>
        <p class="text-[11px] text-[var(--text-secondary)]">{{ t('runtime.customTrust') }}</p>
      </template>
      <dl v-if="diagnostics" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt>{{ t('runtime.selected') }}</dt>
        <dd>{{ t(`runtime.${diagnostics.configuration[kind].source}`) }}</dd>
        <dt>{{ t('runtime.version') }}</dt>
        <dd>{{ diagnostics[kind].version ?? '—' }}</dd>
        <dt>{{ t('runtime.platform') }}</dt>
        <dd>{{ diagnostics[kind].platform }} / {{ diagnostics[kind].arch }}</dd>
        <dt>{{ t('runtime.path') }}</dt>
        <dd class="break-all font-mono">{{ diagnostics[kind].executablePath ?? '—' }}</dd>
        <dt>{{ t('runtime.integrity') }}</dt>
        <dd>{{ t(`runtime.${diagnostics[kind].integrity}`) }}</dd>
        <template v-if="kind === 'node'"
          ><dt>npm / npx</dt>
          <dd>
            {{ diagnostics.node.npm?.version ?? '—' }} / {{ diagnostics.node.npx?.version ?? '—' }}
          </dd></template
        >
      </dl>
      <p
        v-for="detail in diagnostics?.[kind].diagnosticMessages ?? []"
        :key="detail"
        class="text-[11px] text-[var(--warning)]"
      >
        {{ detail }}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          size="sm"
          :disabled="busy || Boolean(diagnostics?.activeSessions)"
          @click="apply(kind)"
          >{{ t('runtime.apply') }}</Button
        >
        <Button size="sm" :disabled="busy" @click="maintain(kind, 'verify')">{{
          t('runtime.verify')
        }}</Button>
        <template v-if="diagnostics?.configuration[kind].source === 'bundled'">
          <Button
            size="sm"
            :disabled="busy || Boolean(diagnostics?.activeSessions)"
            @click="maintain(kind, 'update')"
            >{{ t('runtime.update') }}</Button
          >
          <Button
            size="sm"
            :disabled="busy || !diagnostics?.previous[kind] || Boolean(diagnostics?.activeSessions)"
            @click="maintain(kind, 'rollback')"
            >{{ t('runtime.rollback') }}</Button
          >
        </template>
      </div>
    </div>
    <Button size="sm" :disabled="busy" @click="check">{{ t('runtime.check') }}</Button>
    <div v-if="diagnostics?.mcp.length" class="space-y-1 text-[11px]">
      <h4 class="font-medium">{{ t('runtime.mcp') }}</h4>
      <p v-for="server in diagnostics.mcp" :key="server.id">
        {{ server.id }} · {{ server.type }} ·
        {{
          t(
            server.status === 'available'
              ? 'runtime.mcpAvailable'
              : server.status === 'unavailable'
                ? 'runtime.mcpUnavailable'
                : 'runtime.mcpExternal'
          )
        }}
      </p>
    </div>
    <EnvironmentTaskProgress v-if="task" :task="task" @cancel="api.pi.cancelInstall()" />
    <p v-if="message" role="status" class="text-[11px] text-[var(--success)]">{{ message }}</p>
    <p v-if="error" role="alert" class="text-[11px] text-[var(--error)]">{{ error }}</p>
  </section>
</template>
