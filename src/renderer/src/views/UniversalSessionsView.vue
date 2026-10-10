<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import { ChevronRight, FileText, FolderOpen, MessageSquare, Play, ShieldCheck } from '@lucide/vue'
import {
  SOURCE_PROVIDERS,
  SOURCE_LABELS,
  type SourceProvider,
  type UniversalSession,
  type UniversalMessage,
  type SessionHandoff,
  type UniversalProjectResolution,
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

const { t, locale } = useI18n()
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
const resolvingProject = ref(false)
const projectResolution = ref<UniversalProjectResolution['status']>('unrecorded')
const changeProject = ref(false)
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
const SESSION_ROW_HEIGHT = 112
const listStart = computed(() => Math.max(0, Math.floor(scrollTop.value / SESSION_ROW_HEIGHT) - 3))
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
const dateFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' })
)
const dateTimeFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
)
const numberFormatter = computed(() => new Intl.NumberFormat(locale.value))
function formatDate(value?: string, includeTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return (includeTime ? dateTimeFormatter.value : dateFormatter.value).format(date)
}
function projectName(session: UniversalSession) {
  const path = session.workspacePath ?? session.projectPath
  return path?.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path ?? '—'
}
function failure(e: unknown) {
  error.value = getErrorMessage(e)
}
async function beginHandoff() {
  if (!selected.value) return
  const current = ++handoffRevision
  const id = selected.value.id
  preparing.value = false
  resolvingProject.value = true
  changeProject.value = false
  projectResolution.value = 'unrecorded'
  handoffOpen.value = true
  handoff.value = null
  instruction.value = ''
  error.value = ''
  try {
    const result = await api().resolveProject(id)
    if (current !== handoffRevision || disposed || !handoffOpen.value || selected.value?.id !== id)
      return
    projectResolution.value = result.status
    linkPath.value = result.status === 'available' ? result.path : ''
    const sourcePath = linkPath.value
    // Reuse an imported project's complete source-folder list when cwd is inside its repository.
    if (
      !selected.value.workspacePath &&
      sourcePath &&
      isPathWithinProjectRoots(sourcePath, linkedProjects.value) &&
      !linkedProjects.value.some((p) => projectIdentityKey(p) === projectIdentityKey(sourcePath))
    ) {
      try {
        const git = await getApi().git.status(sourcePath)
        const matched = linkedProjects.value.find(
          (p) => projectIdentityKey(p) === projectIdentityKey(git.repositoryRoot ?? '')
        )
        if (
          current === handoffRevision &&
          !disposed &&
          handoffOpen.value &&
          selected.value?.id === id &&
          linkPath.value === sourcePath &&
          matched
        )
          linkPath.value = matched
      } catch {
        // A non-Git directory can still be used as the recorded working directory.
      }
    }
  } catch (e) {
    if (current === handoffRevision && !disposed) failure(e)
  } finally {
    if (current === handoffRevision) resolvingProject.value = false
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
  resolvingProject.value = false
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
  const current = handoffRevision
  const id = selected.value?.id
  try {
    const chosen = await getApi().workspace.pickDirectory()
    if (
      chosen &&
      current === handoffRevision &&
      !disposed &&
      handoffOpen.value &&
      selected.value?.id === id
    )
      linkPath.value = chosen
  } catch (e) {
    if (current === handoffRevision && !disposed) failure(e)
  }
}
async function saveLink() {
  if (!selected.value || !linkPath.value) return null
  const id = selected.value.id
  const root = linkPath.value
  const current = messageRevision
  try {
    const roots =
      selected.value.workspacePath &&
      projectIdentityKey(selected.value.workspacePath) === projectIdentityKey(root)
        ? (selected.value.workspaceRoots ?? workspace.projectSourceRoots(root))
        : workspace.projectSourceRoots(root)
    // IPC needs a plain DTO, including when this array came from a reactive saved session.
    const mapped = await api().map(id, root, [...roots])
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
  if (!selected.value || !linkPath.value || resolvingProject.value || !instruction.value.trim())
    return
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
    resolvingProject.value = false
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
      ><time v-else :datetime="status.lastSync"
        >{{ t('universal.synced') }}: {{ formatDate(status.lastSync, true) }}</time
      >
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
          <div class="relative" :style="{ height: `${items.length * SESSION_ROW_HEIGHT}px` }">
            <button
              v-for="row in visible"
              :key="row.session.id"
              type="button"
              class="history-session-card"
              :class="{ active: selected?.id === row.session.id }"
              :style="{ top: `${row.index * SESSION_ROW_HEIGHT + 4}px` }"
              :aria-label="`${t('universal.view')}: ${row.session.title}`"
              :aria-pressed="selected?.id === row.session.id"
              :data-testid="`history-session-${row.session.id}`"
              @click="view(row.session)"
            >
              <span class="flex items-center justify-between gap-2 text-[10px]">
                <span class="history-provider-badge">{{
                  SOURCE_LABELS[row.session.provider]
                }}</span>
                <time
                  :datetime="row.session.updatedAt"
                  :title="formatDate(row.session.updatedAt, true)"
                  >{{ formatDate(row.session.updatedAt) }}</time
                >
              </span>
              <span class="history-session-title" :title="row.session.title">
                {{ row.session.title }}
              </span>
              <span class="flex min-w-0 items-center gap-1.5 text-[11px]">
                <FolderOpen class="size-3 shrink-0" aria-hidden="true" />
                <span
                  class="min-w-0 flex-1 truncate"
                  :title="row.session.workspacePath ?? row.session.projectPath"
                >
                  {{ projectName(row.session) }}
                </span>
                <span
                  v-if="row.session.source.status !== 'available'"
                  class="text-[var(--warning)]"
                >
                  {{ t('universal.missing') }}
                </span>
                <ChevronRight
                  class="history-session-chevron size-3.5 shrink-0"
                  aria-hidden="true"
                />
              </span>
            </button>
          </div>
          <Button v-if="items.length < total" :loading="loading" @click="load(false)">{{
            t('universal.more')
          }}</Button>
        </div>
      </section>
      <section class="flex min-w-0 flex-1 flex-col" :aria-label="t('universal.view')">
        <template v-if="selected">
          <header class="history-detail-header" data-testid="history-detail-header">
            <div class="flex items-start gap-4">
              <div class="min-w-0 flex-1">
                <div class="mb-2 flex flex-wrap items-center gap-2">
                  <span class="history-provider-badge">{{ SOURCE_LABELS[selected.provider] }}</span>
                  <span class="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                    <ShieldCheck class="size-3" aria-hidden="true" />
                    {{ t('universal.readOnly') }}
                  </span>
                </div>
                <h2 class="history-detail-title" :title="selected.title">{{ selected.title }}</h2>
              </div>
              <Button
                variant="primary"
                :disabled="
                  viewing || selected.source.status !== 'available' || !selected.messageCount
                "
                data-testid="history-continue-task"
                @click="beginHandoff"
                ><Play class="size-3.5" aria-hidden="true" />{{ t('universal.continue') }}</Button
              >
            </div>
            <div
              class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[var(--text-secondary)]"
            >
              <span
                class="flex min-w-0 items-center gap-1.5"
                :title="selected.workspacePath ?? selected.projectPath"
              >
                <FolderOpen class="size-3.5 shrink-0" aria-hidden="true" />
                <span class="max-w-48 truncate">{{ projectName(selected) }}</span>
              </span>
              <span class="flex items-center gap-1.5">
                <MessageSquare class="size-3.5" aria-hidden="true" />
                {{
                  t('universal.messages', { count: numberFormatter.format(selected.messageCount) })
                }}
              </span>
              <span>{{
                selected.metadata.tokens !== undefined
                  ? `${t('universal.tokens')}: ${numberFormatter.format(selected.metadata.tokens)}`
                  : t('universal.noTokens')
              }}</span>
              <time :datetime="selected.updatedAt">{{ formatDate(selected.updatedAt, true) }}</time>
            </div>
            <div
              class="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2 text-[11px] text-[var(--text-tertiary)]"
            >
              <details class="min-w-0 max-w-full">
                <summary
                  class="flex cursor-pointer items-center gap-1.5 hover:text-[var(--text-secondary)]"
                >
                  <FileText class="size-3" aria-hidden="true" />{{ t('universal.source') }}
                  <ChevronRight class="history-source-chevron size-3" aria-hidden="true" />
                </summary>
                <p class="mt-2 break-all">{{ selected.source.path }}</p>
              </details>
              <details v-if="selected.warnings.length">
                <summary class="cursor-pointer hover:text-[var(--text-secondary)]">
                  {{ t('universal.warnings') }}
                </summary>
                <p v-for="notice in selected.warnings" :key="notice" class="mt-1">{{ notice }}</p>
              </details>
            </div>
            <p v-if="selected.source.status !== 'available'" class="text-xs text-[var(--warning)]">
              {{ t('universal.missing') }}
            </p>
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
        <section
          class="handoff-project"
          data-testid="handoff-project"
          :aria-busy="resolvingProject"
        >
          <div class="flex items-start gap-3">
            <FolderOpen class="mt-0.5 size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <p class="text-xs text-[var(--text-secondary)]">
                {{ t('universal.workingDirectory') }}
              </p>
              <p v-if="resolvingProject" class="mt-1 text-sm" role="status">
                {{ t('common.loading') }}
              </p>
              <template v-else-if="linkPath">
                <p class="mt-1 text-sm font-medium">
                  {{ linkPath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || linkPath }}
                </p>
                <p
                  class="mt-1 break-all text-xs text-[var(--text-secondary)]"
                  data-testid="handoff-project-path"
                >
                  {{ linkPath }}
                </p>
                <p class="mt-2 text-xs text-[var(--text-secondary)]">
                  {{ t('universal.projectReady') }}
                </p>
              </template>
              <p v-else class="mt-1 text-sm text-[var(--warning)]">
                {{
                  t(
                    projectResolution === 'missing'
                      ? 'universal.projectMissing'
                      : 'universal.projectUnrecorded'
                  )
                }}
              </p>
            </div>
            <Button
              v-if="linkPath && !resolvingProject"
              size="sm"
              @click="changeProject = !changeProject"
              >{{ t('universal.changeProject') }}</Button
            >
          </div>
          <div
            v-if="!resolvingProject && (changeProject || !linkPath)"
            class="mt-3 flex items-end gap-2"
          >
            <label class="min-w-0 flex-1 text-xs text-[var(--text-secondary)]"
              >{{ t('universal.choose')
              }}<select v-model="linkPath" class="history-input mt-1" :disabled="preparing">
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
            <Button :disabled="preparing" @click="browseProject">{{
              t('universal.browse')
            }}</Button>
          </div>
        </section>
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
          :disabled="resolvingProject || !linkPath || !instruction.trim()"
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
.handoff-project {
  padding: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}
.history-session-card {
  position: absolute;
  left: 12px;
  right: 12px;
  display: flex;
  height: 104px;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-tertiary);
  text-align: left;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}
.history-session-card:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.history-session-card.active {
  border-color: var(--accent-border);
  background: var(--accent-tint);
  box-shadow: inset 3px 0 var(--accent);
}
.history-session-card:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.history-session-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.history-provider-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-inset);
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 14px;
}
.history-session-card.active .history-provider-badge,
.history-session-card.active .history-session-chevron {
  color: var(--accent);
}
.history-detail-header {
  padding: 20px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}
.history-detail-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  overflow-wrap: anywhere;
}
details[open] .history-source-chevron {
  transform: rotate(90deg);
}
@media (prefers-reduced-motion: reduce) {
  .history-session-card {
    transition: none;
  }
}
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
