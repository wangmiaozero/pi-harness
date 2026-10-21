<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi, getErrorMessage } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { useHarnessStore } from '@renderer/stores/harness'
import { useSessionStore } from '@renderer/stores/sessions'
import type { PluginDescriptor } from '@shared/harness-plugins/types'
const { t } = useI18n()
const plugins = ref<PluginDescriptor[]>([]),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  runId = ref('')
const harness = useHarnessStore(),
  sessions = useSessionStore()
const api = () => getApi().harnessPlugins
async function refresh(): Promise<void> {
  plugins.value = await api().list()
}
async function action(work: () => Promise<unknown>): Promise<void> {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await work()
  } catch (e) {
    error.value = getErrorMessage(e)
  } finally {
    try {
      await refresh()
    } catch (e) {
      error.value = getErrorMessage(e)
    }
    busy.value = false
  }
}
async function remove(id: string): Promise<void> {
  if (
    await askConfirm({
      title: t('harnessPlugins.uninstall'),
      description: t('harnessPlugins.uninstallHint'),
      tone: 'danger'
    })
  )
    await action(() => api().uninstall(id))
}
async function apply(id: string, key: string): Promise<void> {
  await action(async () => {
    const created = await api().applyTeam(id, key)
    if (created) notice.value = t('harnessPlugins.teamCreated')
  })
}
function selectedSession(): string {
  return harness.runs.find((run) => run.id === runId.value)?.sessionId ?? sessions.currentId ?? ''
}
onMounted(() => {
  void action(async () => {})
})
</script>
<template>
  <section data-testid="harness-plugins-panel" class="space-y-4">
    <div class="harness-card space-y-3">
      <h3 class="harness-card-title">{{ t('harnessPlugins.title') }}</h3>
      <p class="text-[12px] text-[var(--text-secondary)]">{{ t('harnessPlugins.intro') }}</p>
      <p class="text-[11px] text-[var(--warning)]">{{ t('harnessPlugins.trustHint') }}</p>
      <div class="flex flex-wrap gap-2">
        <button
          class="plugin-button"
          data-testid="harness-plugin-install"
          :disabled="busy"
          @click="action(() => api().installLocal())"
        >
          {{ t('harnessPlugins.install') }}
        </button>
        <button class="plugin-button" :disabled="busy" @click="action(async () => {})">
          {{ t('harnessPlugins.refresh') }}
        </button>
        <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          {{ t('harnessPlugins.run') }}
          <select
            v-model="runId"
            class="max-w-64 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1"
            data-testid="harness-plugin-run"
          >
            <option value="">{{ t('harnessPlugins.selectRun') }}</option>
            <option v-for="run in harness.runs" :key="run.id" :value="run.id">
              {{ run.id.slice(0, 12) }} · {{ run.status }}
            </option>
          </select>
        </label>
      </div>
    </div>
    <p v-if="error" role="alert" class="text-[12px] text-[var(--error)]">{{ error }}</p>
    <p v-if="notice" role="status" class="text-[12px] text-[var(--success)]">{{ notice }}</p>
    <p v-if="!plugins.length" class="text-[12px] text-[var(--text-tertiary)]">
      {{ t('harnessPlugins.empty') }}
    </p>
    <article
      v-for="plugin in plugins"
      :key="plugin.manifest.id"
      class="harness-card space-y-3"
      data-testid="harness-plugin-card"
    >
      <div class="flex flex-wrap items-center gap-2 text-[13px]">
        <strong class="text-[var(--text-primary)]">{{ plugin.manifest.name }}</strong>
        <span class="text-[var(--text-tertiary)]"
          >{{ plugin.manifest.version }} · API {{ plugin.manifest.apiVersion }}</span
        >
        <span :class="plugin.compatible ? 'text-[var(--success)]' : 'text-[var(--error)]'">{{
          t(plugin.compatible ? 'harnessPlugins.compatible' : 'harnessPlugins.incompatible')
        }}</span>
        <span
          class="text-[var(--text-secondary)]"
          data-testid="harness-plugin-status"
          :data-status="plugin.status"
          >{{ t(`harnessPlugins.status_${plugin.status}`) }}</span
        >
      </div>
      <p class="text-[11px] text-[var(--text-tertiary)]">
        {{ plugin.manifest.id }} · {{ plugin.manifest.author }}
      </p>
      <p class="text-[12px] text-[var(--text-secondary)]">{{ plugin.manifest.description }}</p>
      <p class="text-[11px] text-[var(--text-secondary)]">
        {{ t(plugin.manifest.entry ? 'harnessPlugins.code' : 'harnessPlugins.declarative') }}
      </p>
      <div class="text-[11px] text-[var(--text-secondary)]">
        <p>
          {{ t('harnessPlugins.permissions') }}:
          {{ plugin.manifest.permissions.join(', ') || t('harnessPlugins.none') }}
        </p>
        <p>
          {{ t('harnessPlugins.granted') }}:
          {{ plugin.grants.join(', ') || t('harnessPlugins.none') }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="plugin-button"
          :disabled="busy || !plugin.compatible"
          data-testid="harness-plugin-toggle"
          @click="action(() => api().setEnabled(plugin.manifest.id, !plugin.enabled))"
        >
          {{ t(plugin.enabled ? 'harnessPlugins.disable' : 'harnessPlugins.enable') }}
        </button>
        <button class="plugin-button" :disabled="busy" @click="remove(plugin.manifest.id)">
          {{ t('harnessPlugins.uninstall') }}
        </button>
        <button
          v-for="evaluator in plugin.manifest.contributions.evaluators"
          :key="evaluator.id"
          class="plugin-button"
          :disabled="busy || plugin.status !== 'active' || !runId"
          @click="
            action(() => api().evaluate(plugin.manifest.id, evaluator.id, selectedSession(), runId))
          "
        >
          {{ t('harnessPlugins.evaluate') }} · {{ evaluator.id }}
        </button>
        <button
          v-for="exporter in plugin.manifest.contributions.exporters"
          :key="exporter.id"
          class="plugin-button"
          :disabled="busy || plugin.status !== 'active' || !runId"
          @click="
            action(() =>
              api().exportTrace(plugin.manifest.id, exporter.id, selectedSession(), runId)
            )
          "
        >
          {{ t('harnessPlugins.export') }} · {{ exporter.id }}
        </button>
        <button
          v-for="team in plugin.manifest.contributions.teams"
          :key="team.id"
          class="plugin-button"
          :disabled="busy || plugin.status !== 'active'"
          @click="apply(plugin.manifest.id, team.id)"
        >
          {{ t('harnessPlugins.applyTeam') }} · {{ team.name }}
        </button>
      </div>
      <details class="text-[11px] text-[var(--text-secondary)]">
        <summary class="cursor-pointer">
          {{ t('harnessPlugins.logs') }} · {{ plugin.diagnostics.length }} ·
          {{ t('harnessPlugins.dropped') }} {{ plugin.droppedEvents }}
        </summary>
        <ul class="mt-2 space-y-1 break-words">
          <li v-for="(item, index) in plugin.diagnostics" :key="index">
            {{ new Date(item.at).toLocaleTimeString() }} · {{ item.level }} · {{ item.code }} ·
            {{ item.message }}
          </li>
        </ul>
      </details>
      <details v-if="plugin.results.length" class="text-[11px] text-[var(--text-secondary)]">
        <summary class="cursor-pointer">{{ t('harnessPlugins.results') }}</summary>
        <pre class="mt-2 overflow-auto whitespace-pre-wrap break-words">{{
          JSON.stringify(plugin.results, null, 2)
        }}</pre>
      </details>
    </article>
  </section>
</template>
<style scoped>
.plugin-button {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 5px 9px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-surface);
}
.plugin-button:hover {
  background: var(--bg-hover);
}
.plugin-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.plugin-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
