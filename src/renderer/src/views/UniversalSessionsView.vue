<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import {
  SOURCE_PROVIDERS,
  SOURCE_LABELS,
  type SourceProvider,
  type UniversalSession,
  type UniversalMessage,
  type SessionHandoff,
  type UniversalSyncStatus,
  type SourceLocation
} from '@shared/universal/schema'
import { projectIdentityKey, isPathWithinProjectRoots } from '@shared/workspace/project-identity'
import { getApi, getErrorMessage } from '@renderer/composables/useApi'
import { useSessionStore } from '@renderer/stores/sessions'
import { useAgentStore } from '@renderer/stores/agent'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import HistoryMessage from '@renderer/components/universal/HistoryMessage.vue'
import HistoryDatePicker from '@renderer/components/universal/HistoryDatePicker.vue'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const workspace = useWorkspaceStore()
const nativeSessions = useSessionStore()
const api = () => getApi().universal
const items = ref<UniversalSession[]>([])
const sources = ref<SourceLocation[]>([])
const total = ref(0)
const indexedProjects = ref<string[]>([])
const provider = ref<SourceProvider | ''>('')
const project = ref('')
const query = ref('')
const after = ref('')
const before = ref('')
const status = ref<UniversalSyncStatus>({
  running: false,
  cancelled: false,
  scanned: 0,
  changed: 0,
  errors: []
})
const error = ref('')
const selected = ref<UniversalSession | null>(null)
const messages = ref<UniversalMessage[]>([])
const messageOffset = ref(0)
const viewing = ref(false)
const preparing = ref(false)
const continuing = ref(false)
const handoffOpen = ref(false)
const clearOpen = ref(false)
const sourcePickerOpen = ref(false)
const addingSource = ref(false)
const addedProvider = ref<SourceProvider>('claude')
const linkPath = ref('')
const instruction = ref('')
const handoff = ref<SessionHandoff | null>(null)
const scrollTop = ref(0)
const loading = ref(false)
const listElement = ref<HTMLElement | null>(null)
let revision = 0
let messageRevision = 0
let handoffRevision = 0
let debounce: ReturnType<typeof setTimeout> | null = null
let polling: ReturnType<typeof setInterval> | null = null
let disposed = false
const listStart = computed(() => Math.max(0, Math.floor(scrollTop.value / 104) - 3))
const visible = computed(() =>
  items.value
    .slice(listStart.value, listStart.value + 24)
    .map((session, index) => ({ session, index: listStart.value + index }))
)
const projectOptions = computed(() => [
  ...new Set([
    ...workspace.importedProjectRoots,
    ...nativeSessions.projects.map((p) => p.projectRoot),
    ...indexedProjects.value
  ])
])
const linkedProjects = computed(() => [
  ...new Set([
    ...workspace.importedProjectRoots,
    ...nativeSessions.projects.map((p) => p.projectRoot)
  ])
])
const claimSections = computed(() =>
  handoff.value
    ? [
        { label: t('universal.completed'), rows: handoff.value.completed },
        { label: t('universal.remaining'), rows: handoff.value.remaining },
        { label: t('universal.decisions'), rows: handoff.value.decisions },
        { label: t('universal.constraints'), rows: handoff.value.constraints },
        { label: t('universal.issues'), rows: handoff.value.unresolvedIssues }
      ]
    : []
)
function failure(e: unknown) {
  error.value = getErrorMessage(e)
}
async function beginHandoff() {
  const current = ++handoffRevision
  preparing.value = false
  handoffOpen.value = true
  handoff.value = null
  instruction.value = ''
  const sourcePath = selected.value?.projectPath
  // Resolve a recorded subdirectory only inside an already imported project.
  if (!linkPath.value && sourcePath && isPathWithinProjectRoots(sourcePath, linkedProjects.value)) {
    try {
      const git = await getApi().git.status(sourcePath)
      const matched = linkedProjects.value.find(
        (p) => projectIdentityKey(p) === projectIdentityKey(git.repositoryRoot ?? '')
      )
      if (
        current === handoffRevision &&
        !disposed &&
        handoffOpen.value &&
        !linkPath.value &&
        matched
      )
        linkPath.value = matched
    } catch {
      // Non-Git or unavailable projects still support an explicit user choice.
    }
  }
}
async function load(reset = true) {
  const current = ++revision
  loading.value = true
  try {
    const result = await api().list({
      provider: provider.value || undefined,
      projectPath: project.value || undefined,
      query: query.value || undefined,
      after: after.value ? new Date(`${after.value}T00:00:00`).toISOString() : undefined,
      before: before.value ? new Date(`${before.value}T23:59:59.999`).toISOString() : undefined,
      offset: reset ? 0 : items.value.length,
      limit: 100
    })
    if (current !== revision || disposed) return
    items.value = reset ? result.sessions : [...items.value, ...result.sessions]
    total.value = result.total
    indexedProjects.value = result.projects
    if (reset) {
      scrollTop.value = 0
      if (listElement.value) listElement.value.scrollTop = 0
    }
  } catch (e) {
    if (current === revision) failure(e)
  } finally {
    if (current === revision) loading.value = false
  }
}
async function sync() {
  if (status.value.running) return
  status.value.running = true
  error.value = ''
  try {
    await api().sync()
    status.value = await api().status()
    sources.value = await api().sources()
    await load()
  } catch (e) {
    failure(e)
    status.value.running = false
  }
}
async function view(session: UniversalSession, offset = 0) {
  handoffRevision++
  const current = ++messageRevision
  selected.value = session
  handoff.value = null
  viewing.value = true
  error.value = ''
  linkPath.value =
    session.workspacePath ??
    linkedProjects.value.find(
      (p) => projectIdentityKey(p) === projectIdentityKey(session.projectPath ?? '')
    ) ??
    ''
  messages.value = []
  try {
    const result = await api().read({ id: session.id, offset, limit: 50 })
    if (current !== messageRevision || disposed) return
    selected.value = result.session
    linkPath.value = result.session.workspacePath ?? linkPath.value
    messages.value = result.messages
    messageOffset.value = offset
  } catch (e) {
    if (current === messageRevision) failure(e)
  } finally {
    if (current === messageRevision) viewing.value = false
  }
}
function addSource() {
  addedProvider.value = provider.value || 'claude'
  sourcePickerOpen.value = true
}
async function chooseSourceFolder() {
  addingSource.value = true
  try {
    const location = await api().addSource(addedProvider.value)
    sourcePickerOpen.value = false
    if (location) await sync()
  } catch (e) {
    failure(e)
  } finally {
    addingSource.value = false
  }
}
async function browseProject() {
  try {
    const chosen = await getApi().workspace.pickDirectory()
    if (chosen) linkPath.value = chosen
  } catch (e) {
    failure(e)
  }
}
async function saveLink() {
  if (!selected.value || !linkPath.value) return null
  const id = selected.value.id
  const root = linkPath.value
  const current = messageRevision
  try {
    const mapped = await api().map(id, root, workspace.projectSourceRoots(root))
    if (
      current === messageRevision &&
      !disposed &&
      selected.value?.id === id &&
      linkPath.value === root
    ) {
      selected.value = mapped
      linkPath.value = mapped.workspacePath ?? root
      handoff.value = null
      await load()
    }
    return mapped
  } catch (e) {
    if (current === messageRevision && !disposed) failure(e)
    return null
  }
}
async function prepare() {
  if (!selected.value || !instruction.value.trim()) return
  const current = ++handoffRevision
  const id = selected.value.id
  const requested = instruction.value
  preparing.value = true
  handoff.value = null
  error.value = ''
  try {
    const mapped = await saveLink()
    if (
      !mapped ||
      current !== handoffRevision ||
      disposed ||
      !handoffOpen.value ||
      instruction.value !== requested ||
      selected.value?.id !== id
    )
      return
    const preview = await api().preview(id, requested)
    if (
      current !== handoffRevision ||
      disposed ||
      !handoffOpen.value ||
      selected.value?.id !== id ||
      linkPath.value !== mapped.workspacePath ||
      instruction.value !== requested
    )
      return
    handoff.value = preview
    instruction.value = preview.instruction
  } catch (e) {
    if (current === handoffRevision && !disposed) failure(e)
  } finally {
    if (current === handoffRevision) preparing.value = false
  }
}
async function continueTask() {
  if (!handoff.value) return
  continuing.value = true
  error.value = ''
  try {
    const result = await api().continue(handoff.value.id)
    handoff.value = result.handoff
    await openPi(result.sessionId)
  } catch (e) {
    failure(e)
  } finally {
    continuing.value = false
  }
}
async function openPi(sessionId: string) {
  await nativeSessions.refresh(true)
  await workspace.restore({ restoreTabs: true, autoOpenLastProject: false })
  if (!nativeSessions.items.some((s) => s.id === sessionId) && handoff.value)
    useAgentStore().adoptRunningSession(
      sessionId,
      handoff.value.workspacePath,
      handoff.value.instruction
    )
  workspace.ensureChatTab(sessionId, selected.value?.title ?? 'Pi')
  handoffOpen.value = false
  await router.push('/workspace')
}
async function toggleWatch(event: Event) {
  try {
    await api().setWatch((event.target as HTMLInputElement).checked)
    status.value = await api().status()
  } catch (e) {
    failure(e)
  }
}
async function clearIndex() {
  try {
    await api().clear()
    messageRevision++
    handoffRevision++
    selected.value = null
    messages.value = []
    clearOpen.value = false
    await load()
    status.value = await api().status()
  } catch (e) {
    failure(e)
  }
}
function onScroll(event: Event) {
  const element = event.target as HTMLElement
  scrollTop.value = element.scrollTop
  if (
    element.scrollTop + element.clientHeight > element.scrollHeight - 400 &&
    items.value.length < total.value &&
    !loading.value
  )
    void load(false)
}
watch([provider, project, query, after, before], () => {
  revision++
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    void load()
  }, 200)
})
watch(handoffOpen, (open) => {
  if (!open) {
    handoffRevision++
    preparing.value = false
  }
})
onMounted(async () => {
  try {
    workspace.restoreProjectNavigation()
    await nativeSessions.refresh()
    sources.value = await api().sources()
    status.value = await api().status()
    await load()
    const requestedSource =
      typeof route.query.source === 'string' && /^[a-f0-9]{64}$/.test(route.query.source)
        ? route.query.source
        : null
    if (requestedSource && !status.value.lastSync) {
      // A continuation link can survive cache clearing. Rebuild before resolving its source ID.
      status.value.running = true
      await api().sync()
      if (disposed) return
      status.value = await api().status()
      sources.value = await api().sources()
      await load()
    } else if (!status.value.lastSync && !status.value.running) void sync()
    if (requestedSource) {
      const source = await api().read({ id: requestedSource, limit: 1 })
      await view(source.session)
    }
    if (disposed) return
    polling = setInterval(async () => {
      try {
        const previousSync = status.value.lastSync
        status.value = await api().status()
        if (previousSync !== status.value.lastSync) await load()
      } catch {
        /* Explicit actions surface errors. */
      }
    }, 2000)
  } catch (e) {
    failure(e)
  }
})
onBeforeUnmount(() => {
  disposed = true
  revision++
  messageRevision++
  handoffRevision++
  if (debounce) clearTimeout(debounce)
  if (polling) clearInterval(polling)
})
</script>

<template>
  <main
    class="universal-page flex h-full min-h-0 flex-col bg-[var(--bg-base)] text-[var(--text-primary)]"
    data-testid="universal-sessions"
  >
    <header
      class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] px-5 py-4"
    >
      <div>
        <h1 class="text-base font-semibold">{{ t('universal.title') }}</h1>
        <p class="text-xs text-[var(--text-secondary)]">{{ t('universal.description') }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button :disabled="status.running" @click="sync">{{ t('universal.sync') }}</Button
        ><Button v-if="status.running" @click="api().cancelSync()">{{
          t('universal.cancel')
        }}</Button
        ><Button @click="addSource">{{ t('universal.addSource') }}</Button
        ><Button @click="clearOpen = true">{{ t('universal.clear') }}</Button>
      </div>
    </header>
    <p v-if="error" role="alert" class="px-5 py-2 text-sm text-[var(--error)]">{{ error }}</p>
    <div
      class="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-2 text-xs text-[var(--text-secondary)]"
    >
      <span>{{ t('universal.localHint') }} {{ t('universal.readOnly') }}</span>
      <label class="ml-auto flex gap-2"
        ><input type="checkbox" :checked="status.watchEnabled" @change="toggleWatch" />{{
          t('universal.watch')
        }}</label
      >
      <span v-if="status.running" role="status"
        >{{ t('universal.syncing') }} {{ status.scanned }}</span
      ><time v-else>{{ t('universal.synced') }}: {{ status.lastSync ?? '—' }}</time>
      <details v-if="status.errors.length">
        <summary>{{ t('universal.warnings') }} ({{ status.errors.length }})</summary>
        <p v-for="(issue, i) in status.errors" :key="i">
          {{ SOURCE_LABELS[issue.provider] }}: {{ issue.code }}
        </p>
      </details>
    </div>
    <section class="flex min-h-0 flex-1">
      <aside
        class="w-40 shrink-0 overflow-y-auto border-r border-[var(--border-default)] p-3"
        :aria-label="t('universal.source')"
      >
        <button class="source-button" :class="{ active: !provider }" @click="provider = ''">
          {{ t('universal.allSources') }}
        </button>
        <button
          v-for="source in SOURCE_PROVIDERS"
          :key="source"
          class="source-button"
          :class="{ active: provider === source }"
          :data-testid="`history-provider-${source}`"
          @click="provider = source"
        >
          {{ SOURCE_LABELS[source] }}
          <span class="text-[10px]">{{
            sources.some((s) => s.provider === source) ? '●' : '○'
          }}</span>
        </button>
      </aside>
      <section
        class="flex w-[320px] min-w-[260px] flex-col border-r border-[var(--border-default)]"
        :aria-label="t('universal.title')"
      >
        <div class="space-y-2 p-3">
          <input
            v-model="query"
            class="history-input"
            :placeholder="t('universal.search')"
            :aria-label="t('universal.search')"
          />
          <select v-model="project" class="history-input" :aria-label="t('universal.project')">
            <option value="">{{ t('universal.allProjects') }}</option>
            <option v-for="p in projectOptions" :key="p" :value="p">{{ p }}</option>
          </select>
          <div class="flex gap-2">
            <HistoryDatePicker
              v-model="after"
              :label="t('universal.after')"
              :max="before || undefined"
            /><HistoryDatePicker
              v-model="before"
              :label="t('universal.before')"
              :min="after || undefined"
            />
          </div>
          <p class="text-xs text-[var(--text-tertiary)]">
            {{ t('universal.sessions', { count: total }) }}
          </p>
        </div>
        <div
          ref="listElement"
          class="min-h-0 flex-1 overflow-y-auto"
          data-testid="history-session-list"
          @scroll="onScroll"
        >
          <p v-if="!items.length && !loading" class="p-4 text-xs">{{ t('universal.empty') }}</p>
          <div class="relative" :style="{ height: `${items.length * 104}px` }">
            <article
              v-for="row in visible"
              :key="row.session.id"
              class="absolute left-0 right-0 h-[104px] border-b border-[var(--border-subtle)] px-3 py-2"
              :class="{ 'bg-[var(--accent-tint)]': selected?.id === row.session.id }"
              :style="{ top: `${row.index * 104}px` }"
              :data-testid="`history-session-${row.session.id}`"
            >
              <h2 class="truncate text-sm font-medium" :title="row.session.title">
                {{ row.session.title }}
              </h2>
              <p class="truncate text-[11px] text-[var(--text-tertiary)]">
                {{ SOURCE_LABELS[row.session.provider] }} · {{ row.session.updatedAt.slice(0, 10) }}
              </p>
              <p class="truncate text-[11px] text-[var(--text-secondary)]">
                {{ row.session.workspacePath ?? row.session.projectPath ?? '—' }}
              </p>
              <button class="text-xs text-[var(--accent)]" @click="view(row.session)">
                {{ t('universal.view') }}
              </button>
            </article>
          </div>
          <Button v-if="items.length < total" :loading="loading" @click="load(false)">{{
            t('universal.more')
          }}</Button>
        </div>
      </section>
      <section class="flex min-w-0 flex-1 flex-col" :aria-label="t('universal.view')">
        <template v-if="selected">
          <header class="border-b border-[var(--border-subtle)] p-4">
            <div class="flex items-center gap-3">
              <h2 class="min-w-0 flex-1 truncate font-medium">{{ selected.title }}</h2>
              <Button
                variant="primary"
                :disabled="
                  viewing || selected.source.status !== 'available' || !selected.messageCount
                "
                data-testid="history-continue-task"
                @click="beginHandoff"
                >{{ t('universal.continue') }}</Button
              >
            </div>
            <p class="mt-1 text-xs text-[var(--text-tertiary)]">
              {{ SOURCE_LABELS[selected.provider] }} ·
              {{ t('universal.messages', { count: selected.messageCount }) }} ·
              {{
                selected.metadata.tokens !== undefined
                  ? `${t('universal.tokens')}: ${selected.metadata.tokens}`
                  : t('universal.noTokens')
              }}
            </p>
            <p class="mt-1 break-all text-[11px] text-[var(--text-tertiary)]">
              {{ selected.source.path }}
            </p>
            <p v-if="selected.source.status !== 'available'" class="text-xs text-[var(--warning)]">
              {{ t('universal.missing') }}
            </p>
            <details v-if="selected.warnings.length" class="text-xs">
              <summary>{{ t('universal.warnings') }}</summary>
              <p v-for="notice in selected.warnings" :key="notice">{{ notice }}</p>
            </details>
          </header>
          <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" data-testid="history-messages">
            <p v-if="viewing">{{ t('common.loading') }}</p>
            <HistoryMessage v-for="message in messages" :key="message.id" :message="message" />
          </div>
          <footer class="flex justify-between border-t border-[var(--border-subtle)] p-2">
            <Button
              :disabled="messageOffset === 0 || viewing"
              @click="view(selected, Math.max(0, messageOffset - 50))"
              >{{ t('universal.previous') }}</Button
            ><span class="text-xs"
              >{{ messageOffset + 1 }}–{{ messageOffset + messages.length }} /
              {{ selected.messageCount }}</span
            ><Button
              :disabled="messageOffset + messages.length >= selected.messageCount || viewing"
              @click="view(selected, messageOffset + 50)"
              >{{ t('universal.next') }}</Button
            >
          </footer>
        </template>
        <p v-else class="m-auto p-4 text-sm text-[var(--text-tertiary)]">
          {{ t('universal.select') }}
        </p>
      </section>
    </section>
    <Dialog v-model:open="sourcePickerOpen" :title="t('universal.addSource')">
      <label class="block text-sm"
        >{{ t('universal.source') }}
        <select v-model="addedProvider" class="history-input mt-1">
          <option v-for="source in SOURCE_PROVIDERS" :key="source" :value="source">
            {{ SOURCE_LABELS[source] }}
          </option>
        </select>
      </label>
      <template #footer>
        <Button @click="sourcePickerOpen = false">{{ t('common.cancel') }}</Button>
        <Button :loading="addingSource" @click="chooseSourceFolder">{{
          t('universal.browse')
        }}</Button>
      </template>
    </Dialog>
    <Dialog
      v-model:open="clearOpen"
      :title="t('universal.clearTitle')"
      :description="t('universal.clearHint')"
      ><template #footer
        ><Button @click="clearOpen = false">{{ t('common.cancel') }}</Button
        ><Button variant="danger" @click="clearIndex">{{ t('universal.clear') }}</Button></template
      ></Dialog
    >
    <Dialog v-model:open="handoffOpen" :title="t('universal.preview')" large>
      <div class="space-y-3" data-testid="handoff-preview">
        <p class="text-xs text-[var(--text-secondary)]">{{ t('universal.localHint') }}</p>
        <label class="block text-sm"
          >{{ t('universal.link')
          }}<select v-model="linkPath" class="history-input mt-1">
            <option value="">{{ t('universal.choose') }}</option>
            <option
              v-for="p in [...new Set([...linkedProjects, ...(linkPath ? [linkPath] : [])])]"
              :key="p"
              :value="p"
            >
              {{ p }}
            </option>
          </select></label
        >
        <div class="flex gap-2">
          <Button @click="browseProject">{{ t('universal.browse') }}</Button
          ><Button :disabled="!linkPath" @click="saveLink">{{ t('universal.saveLink') }}</Button>
        </div>
        <label class="block text-sm"
          >{{ t('universal.instruction')
          }}<textarea
            v-model="instruction"
            class="history-input mt-1 min-h-20"
            :aria-label="t('universal.instruction')"
            maxlength="8000"
          />
        </label>
        <Button
          :disabled="!linkPath || !instruction.trim()"
          :loading="preparing"
          @click="prepare"
          >{{ t('universal.generate') }}</Button
        >
        <p v-if="error" role="alert" class="text-sm text-[var(--error)]">{{ error }}</p>
        <template v-if="handoff">
          <p class="text-sm text-[var(--warning)]">{{ t('universal.unverified') }}</p>
          <h3 class="font-medium">{{ t('universal.goal') }}</h3>
          <p class="text-sm whitespace-pre-wrap">{{ handoff.goal.text }}</p>
          <section v-for="section in claimSections" :key="section.label">
            <h3 class="text-sm font-medium">{{ section.label }}</h3>
            <p v-if="!section.rows.length" class="text-xs text-[var(--text-tertiary)]">
              {{ t('universal.noClaims') }}
            </p>
            <div
              v-for="(claim, i) in section.rows"
              :key="i"
              class="mt-1 rounded border border-[var(--border-subtle)] p-2 text-xs"
            >
              <p class="whitespace-pre-wrap">{{ claim.text }}</p>
              <p class="text-[var(--text-tertiary)]">
                {{ t('universal.historicalClaim') }} · {{ t('universal.confidence') }}:
                {{ t(`universal.confidence${claim.confidence}`) }}
              </p>
              <details>
                <summary>{{ t('universal.evidence') }}</summary>
                <p v-for="evidence in claim.evidence" :key="evidence" class="break-all">
                  {{ evidence }}
                </p>
              </details>
            </div>
          </section>
          <h3 class="text-sm font-medium">{{ t('universal.files') }}</h3>
          <p v-for="file in handoff.relevantFiles" :key="file.path" class="text-xs">
            {{ file.workspacePath }} / {{ file.path }} ·
            {{ t(file.exists ? 'universal.verifiedFile' : 'universal.missingFile') }}
          </p>
          <h3 class="text-sm font-medium">{{ t('universal.git') }}</h3>
          <div
            v-for="folder in handoff.workspaces ?? [
              { path: handoff.workspacePath, git: handoff.git }
            ]"
            :key="folder.path"
            class="text-xs"
          >
            <p class="break-all">{{ folder.path }}</p>
            <pre class="whitespace-pre-wrap break-all"
              >{{ folder.git.currentCommit ?? '—' }}
{{
                folder.git.status === 'GIT_UNAVAILABLE'
                  ? t('universal.gitUnavailable')
                  : folder.git.status || t('universal.gitClean')
              }}</pre>
          </div>
          <p class="text-xs">{{ t('universal.omitted', { count: handoff.omittedMessages }) }}</p>
          <details>
            <summary class="text-sm">{{ t('universal.excerpt') }}</summary>
            <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{{
              handoff.context
            }}</pre>
          </details>
          <p class="text-xs text-[var(--text-secondary)]">{{ t('universal.modelHint') }}</p>
          <p class="break-all text-xs">
            {{ t('universal.sourceTrace') }}: {{ handoff.sourceProvider }} /
            {{ handoff.sourceSessionId }} / {{ handoff.id }}
          </p>
        </template>
      </div>
      <template #footer
        ><Button @click="handoffOpen = false">{{ t('common.cancel') }}</Button
        ><Button v-if="handoff?.piSessionId" @click="openPi(handoff.piSessionId)">{{
          t('universal.openPi')
        }}</Button
        ><Button
          variant="primary"
          :disabled="
            !handoff || instruction !== handoff.instruction || linkPath !== handoff.workspacePath
          "
          :loading="continuing"
          data-testid="handoff-confirm"
          @click="continueTask"
          >{{ t('universal.confirm') }}</Button
        ></template
      >
    </Dialog>
  </main>
</template>
<style scoped>
.history-input {
  width: 100%;
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-size: 12px;
}
.source-button {
  display: flex;
  width: 100%;
  justify-content: space-between;
  gap: 4px;
  padding: 8px;
  font-size: 12px;
  text-align: left;
  border-radius: var(--radius-sm);
}
.source-button.active {
  background: var(--accent-tint);
  color: var(--accent);
}
@media (max-width: 850px) {
  .universal-page aside {
    width: 110px;
  }
  .universal-page section > section:first-of-type {
    width: 250px;
    min-width: 220px;
  }
}
</style>
