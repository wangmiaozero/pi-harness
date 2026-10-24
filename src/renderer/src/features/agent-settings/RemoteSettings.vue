<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Globe, Plus, RefreshCw, Send, Trash2, MessageSquare } from '@lucide/vue'
import type {
  RemoteHost,
  RemoteApproval,
  RemoteMessage,
  RemoteProject,
  RemoteSession
} from '@shared/agent-settings/schema'
import { getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import SettingsFeedback from './SettingsFeedback.vue'
import { useSettingsAction } from './useSettingsAction'
const { t } = useI18n()
const { busy, error, message, run } = useSettingsAction()
const hosts = ref<RemoteHost[]>([]),
  loaded = ref(false),
  open = ref(false),
  form = ref({ label: '', url: 'ws://127.0.0.1:31416/v1/racp/ws', token: '' })
const activeId = ref(''),
  projects = ref<RemoteProject[]>([]),
  sessions = ref<RemoteSession[]>([]),
  messages = ref<RemoteMessage[]>([]),
  sessionId = ref(''),
  projectId = ref(''),
  prompt = ref('')
const approvals = ref<RemoteApproval[]>([])
const permission = ref<Record<string, 'ask' | 'accept-edits' | 'auto'>>({})
const activeHost = computed(() => hosts.value.find((h) => h.id === activeId.value))
const selectedSession = computed(() => sessions.value.find((s) => s.id === sessionId.value))
let timer: ReturnType<typeof setInterval> | undefined,
  generation = 0,
  refreshing = false
const api = getApi().agentSettings.remote
const load = () =>
  run(async () => {
    hosts.value = await api.list()
    loaded.value = true
  })
async function pair() {
  if (
    await run(async () => {
      await api.pair({ ...form.value })
      form.value.token = ''
      hosts.value = await api.list()
    }, true)
  ) {
    open.value = false
    form.value = { label: '', url: 'ws://127.0.0.1:31416/v1/racp/ws', token: '' }
  }
}
async function connect(host: RemoteHost) {
  await run(async () => {
    await api.connect(host.id)
    hosts.value = await api.list()
  })
}
async function disconnect(host: RemoteHost) {
  await run(async () => {
    await api.disconnect(host.id)
    if (activeId.value === host.id) closePanel()
    hosts.value = await api.list()
  })
}
function closePanel() {
  generation++
  activeId.value = ''
  sessions.value = []
  projects.value = []
  sessionId.value = ''
  messages.value = []
  approvals.value = []
  prompt.value = ''
}
async function remove(host: RemoteHost) {
  if (
    !(await askConfirm({
      title: t('agentSettings.deleteTitle'),
      description: host.label,
      confirmLabel: t('agentSettings.remove')
    }))
  )
    return
  await run(async () => {
    await api.remove(host.id)
    if (activeId.value === host.id) closePanel()
    hosts.value = await api.list()
  })
}
async function openHost(host: RemoteHost) {
  await run(async () => {
    closePanel()
    activeId.value = host.id
    const token = generation
    const [p, s] = await Promise.all([api.projects(host.id), api.sessions(host.id)])
    if (token !== generation) return
    projects.value = p
    sessions.value = s
    projectId.value = p[0]?.id ?? ''
    sessionId.value = s[0]?.id ?? ''
  })
}
async function refresh() {
  if (!activeId.value || refreshing) return
  const token = generation,
    id = activeId.value,
    sid = sessionId.value
  refreshing = true
  try {
    const h = await api.list()
    if (token !== generation || id !== activeId.value) return
    hosts.value = h
    if (h.find((host) => host.id === id)?.status !== 'connected') {
      closePanel()
      return
    }
    const [s, m] = await Promise.all([
      api.sessions(id),
      sid ? api.history(id, sid) : Promise.resolve({ messages: [], approvals: [] })
    ])
    if (token !== generation || id !== activeId.value || sid !== sessionId.value) return
    sessions.value = s
    messages.value = m.messages
    approvals.value = m.approvals
  } finally {
    refreshing = false
  }
}
watch(sessionId, () => {
  generation++
  messages.value = []
  approvals.value = []
  void run(refresh)
})
async function approve(item: RemoteApproval, decision: RemoteApproval['allowedDecisions'][number]) {
  await run(async () => {
    await api.approve({
      id: activeId.value,
      sessionId: sessionId.value,
      approvalId: item.id,
      decision,
      ...(item.kind !== 'tool' && decision === 'approve'
        ? { permissionMode: permission.value[item.id] ?? item.allowedPermissionModes?.[0] }
        : {})
    })
    await refresh()
  })
}
async function create() {
  await run(async () => {
    const session = await api.create(activeId.value, projectId.value)
    sessions.value = await api.sessions(activeId.value)
    sessionId.value = session.id
  })
}
async function send() {
  await run(async () => {
    const text = prompt.value
    await api.prompt(activeId.value, sessionId.value, text)
    if (prompt.value === text) prompt.value = ''
    await refresh()
  })
}
async function stop() {
  await run(async () => {
    await api.stop(activeId.value, sessionId.value)
    await refresh()
  })
}
onMounted(() => {
  void load()
  timer = setInterval(() => {
    if (!busy.value && activeId.value && !document.hidden) void run(refresh)
  }, 3000)
})
onBeforeUnmount(() => {
  generation++
  if (timer) clearInterval(timer)
  form.value.token = ''
})
watch(open, (value) => {
  if (!value) form.value.token = ''
})
</script>
<template>
  <div class="feature-stack">
    <div class="feature-actions">
      <Button variant="primary" :disabled="busy" @click="open = true"
        ><Plus class="size-3.5" />{{ t('agentSettings.pairHost') }}</Button
      ><Button :disabled="busy" @click="load"
        ><RefreshCw class="size-3.5" />{{ t('agentSettings.refresh') }}</Button
      >
    </div>
    <SettingsFeedback :busy="busy" :error="error" :message="message" />
    <div
      v-for="host in hosts"
      :key="host.id"
      class="feature-card"
      :data-testid="`remote-host-${host.label}`"
    >
      <div class="flex items-start gap-4">
        <Globe class="size-7 shrink-0 text-[var(--text-tertiary)]" :stroke-width="1.5" />
        <div class="min-w-0 flex-1">
          <h2 class="!mb-1">
            {{ host.label }}
            <span
              class="ml-2 inline-flex items-center gap-1 text-xs font-normal"
              :class="
                host.status === 'connected'
                  ? 'text-[var(--success)]'
                  : 'text-[var(--text-tertiary)]'
              "
              ><span class="size-1.5 rounded-full bg-current" />{{
                t(`agentSettings.${host.status}`)
              }}</span
            >
          </h2>
          <p class="feature-hint break-all">{{ host.url }}</p>
          <p class="feature-hint">{{ t('agentSettings.version') }} {{ host.version }}</p>
        </div>
        <div class="feature-actions">
          <template v-if="host.status === 'connected'"
            ><Button size="sm" :disabled="busy" @click="openHost(host)">{{
              t('agentSettings.openHost')
            }}</Button
            ><Button size="sm" :disabled="busy" @click="disconnect(host)">{{
              t('agentSettings.disconnect')
            }}</Button></template
          ><Button v-else size="sm" :disabled="busy" @click="connect(host)">{{
            t('agentSettings.connect')
          }}</Button
          ><Button
            size="sm"
            :disabled="busy"
            :aria-label="`${t('agentSettings.remove')} ${host.label}`"
            @click="remove(host)"
            ><Trash2 class="size-3.5"
          /></Button>
        </div>
      </div>
    </div>
    <div v-if="loaded && !hosts.length" class="feature-empty">
      <Globe class="mx-auto mb-3 size-10 opacity-40" />
      <p>{{ t('agentSettings.empty') }}</p>
      <p class="feature-hint mt-2">{{ t('agentSettings.pairingHint') }}</p>
    </div>
    <section v-if="activeHost" class="feature-card" data-testid="remote-workspace">
      <div class="feature-actions mb-5">
        <MessageSquare class="size-4" />
        <h2 class="!mb-0 flex-1">
          {{ activeHost.label }} · {{ t('agentSettings.conversations') }}
        </h2>
        <Button :disabled="busy" @click="run(refresh)">{{ t('agentSettings.refresh') }}</Button
        ><Button :disabled="busy" @click="closePanel">{{ t('common.close') }}</Button>
      </div>
      <div class="feature-grid mb-4">
        <label class="feature-field"
          >{{ t('agentSettings.projects')
          }}<select v-model="projectId" class="feature-input" :disabled="busy">
            <option v-if="!projects.length" value="">{{ t('agentSettings.noProjects') }}</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select></label
        >
        <div class="flex items-end">
          <Button :disabled="busy || !projectId" @click="create"
            ><Plus class="size-3.5" />{{ t('agentSettings.newRemoteSession') }}</Button
          >
        </div>
      </div>
      <label class="feature-field mb-4"
        >{{ t('agentSettings.conversations')
        }}<select v-model="sessionId" class="feature-input" :disabled="busy">
          <option v-if="!sessions.length" value="">{{ t('agentSettings.noSessions') }}</option>
          <option v-for="session in sessions" :key="session.id" :value="session.id">
            {{ session.title || session.id }}
          </option>
        </select></label
      >
      <div
        role="log"
        class="max-h-[480px] min-h-[180px] space-y-4 overflow-y-auto rounded-lg bg-[var(--bg-base)] p-4"
      >
        <p v-if="!messages.length" class="feature-hint py-8 text-center">
          {{ t('agentSettings.remoteEmpty') }}
        </p>
        <div v-for="(item, index) in messages" :key="index">
          <p class="mb-1 text-xs font-semibold text-[var(--accent)]">
            {{
              ['user', 'assistant'].includes(item.role)
                ? t(`agentSettings.${item.role}`)
                : item.role
            }}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{{ item.text }}</p>
        </div>
      </div>
      <div
        v-for="item in approvals"
        :key="item.id"
        class="mt-4 rounded-lg border border-[var(--warning)] p-4"
      >
        <h3 class="mb-2 text-sm font-semibold">{{ t('agentSettings.approvalRequired') }}</h3>
        <p class="mb-3 whitespace-pre-wrap break-words text-sm">{{ item.summary }}</p>
        <label
          v-if="item.kind !== 'tool' && item.allowedPermissionModes?.length"
          class="feature-field mb-3"
          >{{ t('agentSettings.defaultPermissionMode')
          }}<select v-model="permission[item.id]" class="feature-input">
            <option v-for="mode in item.allowedPermissionModes" :key="mode" :value="mode">
              {{ mode }}
            </option>
          </select></label
        >
        <div class="feature-actions">
          <Button
            v-for="decision in item.allowedDecisions"
            :key="decision"
            :disabled="busy"
            @click="approve(item, decision)"
            >{{ t(`agentSettings.decisions.${decision}`) }}</Button
          >
        </div>
      </div>
      <form class="mt-4" @submit.prevent="send">
        <textarea
          v-model="prompt"
          class="feature-textarea"
          :placeholder="t('agentSettings.remotePrompt')"
          :aria-label="t('agentSettings.remotePrompt')"
          :disabled="busy || !selectedSession"
          maxlength="64000"
        />
        <div class="feature-actions mt-3 justify-end">
          <Button :disabled="busy || !selectedSession" @click="stop">{{
            t('agentSettings.stop')
          }}</Button
          ><Button
            type="submit"
            variant="primary"
            :disabled="busy || !selectedSession || !prompt.trim()"
            ><Send class="size-3.5" />{{ t('agentSettings.send') }}</Button
          >
        </div>
      </form>
    </section>
    <Dialog v-model:open="open" :title="t('agentSettings.pairHost')" wide
      ><div class="agent-settings">
        <form class="feature-stack" @submit.prevent="pair">
          <fieldset :disabled="busy" class="feature-stack">
            <label class="feature-field"
              >{{ t('agentSettings.hostLabel')
              }}<input v-model="form.label" class="feature-input" required maxlength="100" /></label
            ><label class="feature-field"
              >{{ t('agentSettings.hostAddress')
              }}<input
                v-model="form.url"
                class="feature-input"
                required
                type="url"
                maxlength="2048" /></label
            ><label class="feature-field"
              >{{ t('agentSettings.pairingToken')
              }}<input
                v-model="form.token"
                class="feature-input"
                type="password"
                autocomplete="new-password"
                required
                maxlength="4096"
            /></label>
            <p class="feature-hint">{{ t('agentSettings.pairingHint') }}</p>
          </fieldset>
          <SettingsFeedback :error="error" />
          <div class="feature-actions justify-end">
            <Button :disabled="busy" @click="open = false">{{ t('agentSettings.cancel') }}</Button
            ><Button variant="primary" type="submit" :disabled="busy">{{
              t('agentSettings.pairHost')
            }}</Button>
          </div>
        </form>
      </div></Dialog
    >
  </div>
</template>
