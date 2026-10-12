<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Network } from '@lucide/vue'
import { getApi, getErrorPayload } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { useSettingsStore } from '@renderer/stores/settings'
import { themeAppearance } from '@shared/constants/theme'
import { resolveAppLocale } from '@shared/constants/language'
import { architectureLabel, architectureWarning } from '@renderer/i18n/intelligence-details'
import Button from '@renderer/components/ui/Button.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import FileViewer from '@renderer/components/files/FileViewer.vue'
import type {
  AnalysisState,
  ArchitectureSnapshot,
  ArchitectureMap
} from '@shared/intelligence/schema'

const props = defineProps<{ root: string | null; projects?: string[] }>()
const emit = defineEmits<{
  close: []
  explain: [moduleId: string | undefined]
  'select-project': [root: string]
}>()
const { t, locale } = useI18n()
const analysisLocale = computed(() => {
  const resolved = resolveAppLocale('auto', locale.value)
  return resolved === 'en-US' ? 'en' : resolved
})
const settings = useSettingsStore()
const snapshot = ref<ArchitectureSnapshot | null>(null)
const state = ref<AnalysisState>({ phase: 'idle', files: 0 })
const history = ref<Array<{ snapshotId: string; createdAt: string; summary: string }>>([])
const selectedId = ref<string | null>(null)
const search = ref('')
const kind = ref('')
const ai = ref(false)
const activeModel = ref<{ providerKey: string | null; modelId: string | null } | null>(null)
async function refreshModel(): Promise<void> {
  try {
    activeModel.value = await getApi().models.getActive()
  } catch {
    activeModel.value = null
  }
}
void refreshModel()
const unsubscribeModel = getApi().on('config-changed', () => void refreshModel())
const dialogBlocking = ref(false)
const excludes = ref('')
const excludeDrafts = new Map<string, string>()
const map = ref<ArchitectureMap | null>(null)
const mapBusy = ref(false)
let mapVersion = 0
const viewerUrl = computed(() => map.value?.viewerUrl ?? snapshot.value?.viewerUrl ?? null)
const visibleModuleIds = computed(
  () => map.value?.moduleIds ?? snapshot.value?.graph.nodes.slice(0, 48).map((n) => n.id) ?? []
)
const mapOffset = computed(() => map.value?.offset ?? 0)
const packageFilter = ref('')
const error = ref<string | null>(null)
const busy = ref(false)
const viewer = ref<HTMLElement | null>(null)
const source = ref<{ path: string; line: number } | null>(null)
const sourceOpen = ref(false)
let revision = 0
let loadVersion = 0
let pollVersion = 0
let timer: ReturnType<typeof setTimeout> | null = null
const running = computed(
  () => !['idle', 'completed', 'failed', 'cancelled'].includes(state.value.phase)
)
const nodes = computed(
  () =>
    snapshot.value?.graph.nodes.filter(
      (n) =>
        (!kind.value || n.type === kind.value) &&
        (!packageFilter.value || n.packageManifest === packageFilter.value) &&
        `${n.name} ${n.description}`.toLowerCase().includes(search.value.toLowerCase())
    ) ?? []
)
const selected = computed(() => snapshot.value?.graph.nodes.find((n) => n.id === selectedId.value))
const theme = computed(() => themeAppearance(settings.settings?.theme ?? 'dark'))
let resize: ResizeObserver | null = null
let nativeVersion = 0
let scrollFrame = 0
function onScroll(): void {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    void viewerMessage()
  })
}
window.addEventListener('scroll', onScroll, true)
async function viewerMessage(id?: string): Promise<void> {
  const element = viewer.value
  const bounds = element?.getBoundingClientRect()
  const clip = element?.closest('.architecture-layout')?.getBoundingClientRect()
  const column = element?.parentElement?.getBoundingClientRect()
  const left = Math.max(0, bounds?.left ?? 0, clip?.left ?? 0, column?.left ?? 0)
  const top = Math.max(0, bounds?.top ?? 0, clip?.top ?? 0, column?.top ?? 0)
  const right = Math.min(
    bounds?.right ?? 0,
    clip?.right ?? 0,
    column?.right ?? 0,
    window.innerWidth
  )
  const bottom = Math.min(
    bounds?.bottom ?? 0,
    clip?.bottom ?? 0,
    column?.bottom ?? 0,
    window.innerHeight
  )
  const version = revision
  try {
    await getApi().intelligence.viewer({
      url: sourceOpen.value || dialogBlocking.value ? null : viewerUrl.value,
      bounds: {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.max(0, Math.round(right - left)),
        height: Math.max(0, Math.round(bottom - top))
      },
      theme: theme.value,
      ...(id ? { selectedId: id } : {})
    })
  } catch (e) {
    if (version === revision) error.value = getErrorPayload(e).message
  }
}
async function showMap(offset = 0, moduleId?: string): Promise<void> {
  const root = props.root
  const graph = snapshot.value?.graph
  const version = revision
  const requestVersion = ++mapVersion
  if (!root || !graph) return
  mapBusy.value = true
  try {
    const result = await getApi().intelligence.map({
      root,
      snapshotId: graph.snapshotId,
      offset,
      ...(moduleId ? { moduleId } : {}),
      locale: analysisLocale.value
    })
    if (
      version !== revision ||
      requestVersion !== mapVersion ||
      graph.snapshotId !== snapshot.value?.graph.snapshotId
    )
      return
    map.value = result
    await nextTick()
    await viewerMessage(
      selectedId.value && result.moduleIds.includes(selectedId.value) ? selectedId.value : undefined
    )
  } catch (e) {
    if (version === revision && requestVersion === mapVersion)
      error.value = getErrorPayload(e).message
  } finally {
    if (version === revision && requestVersion === mapVersion) mapBusy.value = false
  }
}
function select(id: string): void {
  selectedId.value = id
  if (!visibleModuleIds.value.includes(id)) void showMap(0, id)
  else void viewerMessage(id)
}
const unsubscribe = getApi().on('architecture-selected', (input) => {
  const value = input as { url?: unknown; id?: unknown }
  if (value.url !== viewerUrl.value || typeof value.id !== 'string') return
  if (snapshot.value?.graph.nodes.some((n) => n.id === value.id)) selectedId.value = value.id
})
watch([theme, sourceOpen, dialogBlocking], () => void viewerMessage())
watch(
  viewerUrl,
  async () => {
    const version = ++nativeVersion
    await nextTick()
    if (version !== nativeVersion) return
    resize?.disconnect()
    if (viewer.value) {
      resize = new ResizeObserver(() => void viewerMessage())
      resize.observe(viewer.value)
    }
    void viewerMessage()
  },
  { flush: 'post' }
)
async function load(id?: string): Promise<void> {
  const root = props.root
  const version = revision
  const requestVersion = ++loadVersion
  if (!root) return
  try {
    const result = await getApi().intelligence.snapshot({ root, ...(id ? { snapshotId: id } : {}) })
    const items = await getApi().intelligence.history(root)
    if (version !== revision || requestVersion !== loadVersion) return
    snapshot.value = result
    mapVersion++
    mapBusy.value = false
    map.value = null
    history.value = items
    if (!excludeDrafts.has(root)) excludes.value = result?.graph.revision.excludes.join('\n') ?? ''
    if (!result?.graph.nodes.some((n) => n.id === selectedId.value)) selectedId.value = null
  } catch (e) {
    if (version === revision && requestVersion === loadVersion)
      error.value = getErrorPayload(e).message
  }
}
async function poll(): Promise<void> {
  const requestVersion = ++pollVersion
  if (timer) clearTimeout(timer)
  timer = null
  const root = props.root
  const version = revision
  if (!root) return
  try {
    const next = await getApi().intelligence.status(root)
    if (version !== revision || requestVersion !== pollVersion) return
    const finished = running.value && next.phase === 'completed'
    state.value = next
    if (finished) await load()
    else if (snapshot.value && !running.value) {
      const checked = await getApi().intelligence.snapshot({
        root,
        snapshotId: snapshot.value.graph.snapshotId
      })
      if (
        version === revision &&
        requestVersion === pollVersion &&
        checked &&
        snapshot.value?.graph.snapshotId === checked.graph.snapshotId
      )
        snapshot.value.staleness = checked.staleness
    }
    if (next.phase === 'failed') error.value = t('intelligence.error')
  } catch (e) {
    if (version === revision && requestVersion === pollVersion)
      error.value = getErrorPayload(e).message
  }
  if (version === revision && requestVersion === pollVersion)
    timer = setTimeout(() => void poll(), running.value ? 500 : 5000)
}
watch(
  () => props.root,
  () => {
    revision++
    mapVersion++
    map.value = null
    mapBusy.value = false
    excludes.value = props.root ? (excludeDrafts.get(props.root) ?? '') : ''
    packageFilter.value = ''
    kind.value = ''
    search.value = ''
    ai.value = false
    busy.value = false
    if (timer) clearTimeout(timer)
    snapshot.value = null
    history.value = []
    source.value = null
    sourceOpen.value = false
    selectedId.value = null
    error.value = null
    state.value = { phase: 'idle', files: 0 }
    void load()
    void poll()
  },
  { immediate: true }
)
async function analyze(): Promise<void> {
  if (!props.root) return
  const root = props.root
  const version = revision
  busy.value = true
  error.value = null
  try {
    const next = await getApi().intelligence.analyze({
      root,
      ai: ai.value,
      locale: analysisLocale.value,
      excludes: excludes.value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    })
    if (version === revision) state.value = next
  } catch (e) {
    if (version === revision) error.value = getErrorPayload(e).message
  } finally {
    if (version === revision) busy.value = false
  }
}
async function cancel(): Promise<void> {
  if (props.root) await getApi().intelligence.cancel(props.root)
  await poll()
}
async function openSource(path: string): Promise<void> {
  const root = props.root
  const graph = snapshot.value?.graph
  const module = selected.value
  const version = revision
  if (!root || !graph || !module) return
  try {
    const result = await getApi().intelligence.source(root, graph.snapshotId, module.id, path)
    if (version !== revision) return
    source.value = result
    sourceOpen.value = true
  } catch (e) {
    if (version === revision)
      error.value = `${t('intelligence.sourceUnavailable')} ${getErrorPayload(e).message}`
  }
}
async function exportMap(format: 'html' | 'json' | 'png'): Promise<void> {
  if (props.root && snapshot.value)
    try {
      await getApi().intelligence.export(
        props.root,
        snapshot.value.graph.snapshotId,
        format,
        format !== 'json' ? (viewerUrl.value ?? undefined) : undefined
      )
    } catch (e) {
      error.value = getErrorPayload(e).message
    }
}
async function clear(): Promise<void> {
  const root = props.root
  if (!root) return
  dialogBlocking.value = true
  await viewerMessage()
  try {
    if (
      !(await askConfirm({
        title: t('intelligence.clearTitle'),
        description: t('intelligence.clearHint'),
        confirmLabel: t('intelligence.clear'),
        tone: 'danger'
      }))
    )
      return
    await getApi().intelligence.clear(root)
    await load()
  } catch (e) {
    error.value = getErrorPayload(e).message
  } finally {
    dialogBlocking.value = false
    void viewerMessage()
  }
}

onBeforeUnmount(() => {
  revision++
  nativeVersion++
  mapVersion++
  if (timer) clearTimeout(timer)
  resize?.disconnect()
  window.removeEventListener('scroll', onScroll, true)
  cancelAnimationFrame(scrollFrame)
  unsubscribe()
  unsubscribeModel()
  void getApi().intelligence.viewer({
    url: null,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    theme: theme.value
  })
})
</script>

<template>
  <section
    class="intelligence flex h-full min-h-0 flex-col overflow-hidden"
    data-testid="project-intelligence"
  >
    <header
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] p-3"
    >
      <Network class="size-4 shrink-0" />
      <h2 class="font-semibold">{{ t('intelligence.title') }}</h2>
      <Button size="sm" @click="emit('close')">{{ t('intelligence.close') }}</Button>
      <Button
        v-if="root"
        size="sm"
        variant="primary"
        :disabled="running || busy"
        data-testid="analyze-project"
        @click="analyze"
        >{{ t(snapshot ? 'intelligence.reanalyze' : 'intelligence.analyze') }}</Button
      >
      <Button v-if="running" size="sm" @click="cancel">{{ t('intelligence.cancel') }}</Button>
      <Button v-if="snapshot" size="sm" @click="exportMap('json')">{{
        t('intelligence.exportJson')
      }}</Button>
      <Button v-if="viewerUrl" size="sm" :disabled="mapBusy" @click="exportMap('html')">{{
        t('intelligence.exportHtml')
      }}</Button>
      <Button v-if="viewerUrl" size="sm" :disabled="mapBusy" @click="exportMap('png')">{{
        t('intelligence.exportPng')
      }}</Button>
      <Button v-if="snapshot" size="sm" :disabled="running" @click="clear">{{
        t('intelligence.clear')
      }}</Button>
    </header>
    <div class="shrink-0 space-y-2 border-b border-[var(--border-subtle)] p-3 text-xs">
      <p class="break-all text-[var(--text-secondary)]">
        {{ root || t('intelligence.noProject') }}
      </p>
      <select
        v-if="(projects?.length ?? 0) > 1"
        data-testid="architecture-project"
        class="w-full rounded-[var(--radius-sm)] bg-[var(--bg-input)] p-2"
        :aria-label="t('intelligence.project')"
        :value="root"
        @change="emit('select-project', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="project in projects" :key="project" :value="project">{{ project }}</option>
      </select>
      <p>{{ t('intelligence.localHint') }}</p>
      <div v-if="root" class="flex flex-wrap items-center gap-2">
        <Switch v-model="ai" :disabled="running" :label="t('intelligence.ai')" /><span>{{
          t('intelligence.ai')
        }}</span
        ><span class="text-[var(--text-secondary)]"
          >{{ t('intelligence.model') }}:
          {{
            activeModel?.modelId
              ? `${activeModel.providerKey}/${activeModel.modelId}`
              : t('intelligence.local')
          }}</span
        >
      </div>
      <p v-if="ai" class="text-[var(--text-secondary)]">{{ t('intelligence.aiHint') }}</p>
      <details v-if="root && !running">
        <summary>{{ t('intelligence.excludes') }}</summary>
        <textarea
          v-model="excludes"
          data-testid="architecture-exclusions"
          class="mt-2 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] p-2"
          :aria-label="t('intelligence.excludes')"
          @input="root && excludeDrafts.set(root, ($event.target as HTMLTextAreaElement).value)"
        />
      </details>
      <p role="status" data-testid="architecture-status">
        {{ t(state.waiting ? 'intelligence.waiting' : `intelligence.phases.${state.phase}`) }} ·
        {{ state.files }}
        {{ t('intelligence.files') }}
      </p>
      <p v-if="error" role="alert" class="text-[var(--error)]">{{ error }}</p>
    </div>
    <div
      v-if="!snapshot"
      class="flex flex-1 items-center justify-center p-8 text-[var(--text-secondary)]"
    >
      {{ t('intelligence.empty') }}
    </div>
    <div v-else class="architecture-layout min-h-0 flex-1">
      <aside class="min-h-0 space-y-3 overflow-auto border-r border-[var(--border-subtle)] p-3">
        <input
          v-model="search"
          class="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] p-2 text-xs"
          :placeholder="t('intelligence.search')"
          :aria-label="t('intelligence.search')"
        />
        <select
          v-model="kind"
          class="w-full rounded-[var(--radius-sm)] bg-[var(--bg-input)] p-2 text-xs"
          :aria-label="t('intelligence.allTypes')"
        >
          <option value="">{{ t('intelligence.allTypes') }}</option>
          <option
            v-for="type in [...new Set(snapshot.graph.nodes.map((n) => n.type))]"
            :key="type"
            :value="type"
          >
            {{ architectureLabel(type, locale) }}
          </option>
        </select>
        <select
          v-if="snapshot.graph.project.packages.length"
          v-model="packageFilter"
          class="w-full rounded-[var(--radius-sm)] bg-[var(--bg-input)] p-2 text-xs"
          :aria-label="t('intelligence.packages')"
          data-testid="architecture-packages"
        >
          <option value="">{{ t('intelligence.allPackages') }}</option>
          <option
            v-for="pkg in snapshot.graph.project.packages"
            :key="pkg.manifest"
            :value="pkg.manifest"
          >
            {{ pkg.name }}
          </option>
        </select>
        <label class="block text-xs"
          >{{ t('intelligence.history')
          }}<select
            class="mt-1 w-full rounded-[var(--radius-sm)] bg-[var(--bg-input)] p-2"
            :value="snapshot.graph.snapshotId"
            @change="load(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="item in history" :key="item.snapshotId" :value="item.snapshotId">
              {{ new Date(item.createdAt).toLocaleString(locale) }}
            </option>
          </select></label
        >
        <p class="text-xs">
          {{ snapshot.graph.nodes.length }} {{ t('intelligence.modules') }} ·
          {{ snapshot.graph.edges.length }} {{ t('intelligence.relationships') }}
        </p>
        <button
          v-for="node in nodes"
          :key="node.id"
          type="button"
          class="block w-full break-all rounded-[var(--radius-sm)] p-2 text-left text-xs hover:bg-[var(--bg-hover)] focus-visible:shadow-[var(--focus-ring)]"
          :class="selectedId === node.id ? 'bg-[var(--bg-selected)] text-[var(--accent)]' : ''"
          data-testid="architecture-module"
          @click="select(node.id)"
        >
          {{ node.name }}
        </button>
      </aside>
      <main class="flex min-h-0 min-w-0 flex-col">
        <div class="shrink-0 space-y-1 border-b border-[var(--border-subtle)] p-3 text-xs">
          <p
            :class="
              snapshot.staleness === 'fresh'
                ? 'text-[var(--text-secondary)]'
                : 'text-[var(--warning)]'
            "
          >
            {{
              t(
                `intelligence.${snapshot.staleness === 'fresh' ? 'fresh' : snapshot.staleness === 'stale' ? 'stale' : 'unknown'}`
              )
            }}
          </p>
          <p class="max-h-[120px] overflow-auto" tabindex="0">
            {{
              snapshot.graph.revision.modelId
                ? snapshot.graph.summary
                : t('intelligence.localSummary', {
                    files: snapshot.graph.nodes.length,
                    imports: snapshot.graph.edges.length,
                    packages: snapshot.graph.project.packages.length
                  })
            }}
          </p>
          <p>
            {{ snapshot.graph.project.languages.join(', ') }} ·
            {{ snapshot.graph.project.frameworks.join(', ') }}
          </p>
          <details v-if="snapshot.graph.entrypoints.length">
            <summary>
              {{ t('intelligence.entrypoints') }} ({{ snapshot.graph.entrypoints.length }})
            </summary>
            <button
              v-for="entry in snapshot.graph.entrypoints"
              :key="entry"
              type="button"
              class="block max-w-full break-all text-left text-[var(--accent)]"
              @click="select(snapshot!.graph.nodes.find((n) => n.name === entry)!.id)"
            >
              {{ entry }}
            </button>
          </details>
          <p>
            {{ new Date(snapshot.graph.revision.createdAt).toLocaleString(locale) }} ·
            {{ snapshot.graph.revision.commit?.slice(0, 12) }} ·
            {{ snapshot.graph.revision.modelId || t('intelligence.local') }}
          </p>
          <details v-if="snapshot.graph.warnings.length">
            <summary>
              {{
                snapshot.graph.coverage.partial
                  ? t('intelligence.partial')
                  : t('intelligence.confidence')
              }}
              ({{ snapshot.graph.warnings.length }})
            </summary>
            <p
              v-for="warning in snapshot.graph.warnings"
              :key="warning"
              class="mt-1 text-[var(--text-secondary)]"
            >
              {{ architectureWarning(warning, locale) }}
            </p>
          </details>
        </div>
        <div
          v-if="snapshot.graph.nodes.length > 48 || map?.focus"
          class="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] p-2 text-xs"
          data-testid="architecture-map-pages"
        >
          <span>{{
            map?.focus
              ? t('intelligence.focusedMap')
              : `${mapOffset + 1}–${Math.min(mapOffset + 48, snapshot.graph.nodes.length)} / ${snapshot.graph.nodes.length}`
          }}</span>
          <Button v-if="map?.focus" size="sm" :disabled="mapBusy" @click="showMap()">{{
            t('intelligence.overview')
          }}</Button>
          <template v-else>
            <Button
              size="sm"
              :disabled="mapBusy || mapOffset === 0"
              @click="showMap(mapOffset - 48)"
              >{{ t('intelligence.previousMap') }}</Button
            >
            <Button
              size="sm"
              :disabled="mapBusy || mapOffset + 48 >= snapshot.graph.nodes.length"
              @click="showMap(mapOffset + 48)"
              >{{ t('intelligence.nextMap') }}</Button
            >
          </template>
          <span v-if="mapBusy" role="status">{{ t('intelligence.phases.rendering') }}</span>
        </div>
        <div
          v-if="viewerUrl"
          ref="viewer"
          :key="viewerUrl"
          class="min-h-[240px] w-full flex-1"
          data-testid="architecture-viewer"
          :aria-label="t('intelligence.architecture')"
        />
        <p v-else class="p-6 text-sm">{{ t('intelligence.noViewer') }}</p>
      </main>
      <aside
        class="min-h-0 space-y-3 overflow-auto border-l border-[var(--border-subtle)] p-3 text-xs"
      >
        <p>{{ t('intelligence.context') }}</p>
        <template v-if="selected">
          <h3 class="break-all font-semibold">{{ selected.name }}</h3>
          <p>{{ selected.description }}</p>
          <p>
            {{ t('intelligence.confidence') }}: {{ architectureLabel(selected.evidence, locale) }}
          </p>
          <Button
            size="sm"
            :disabled="mapBusy"
            data-testid="architecture-focus"
            @click="showMap(0, selected.id)"
            >{{ t('intelligence.focus') }}</Button
          >
          <Button size="sm" @click="emit('explain', selected.id)">{{
            t('intelligence.explain')
          }}</Button>
          <button
            v-for="reference in selected.sourceReferences"
            :key="reference.path"
            type="button"
            class="block w-full break-all rounded-[var(--radius-sm)] border border-[var(--border-default)] p-2 text-left hover:bg-[var(--bg-hover)]"
            data-testid="architecture-source"
            @click="openSource(reference.path)"
          >
            {{ t('intelligence.source') }} · {{ reference.path }}:{{ reference.startLine }}
          </button>
          <h4>{{ t('intelligence.upstream') }}</h4>
          <button
            v-for="edge in snapshot.graph.edges.filter((e) => e.target === selected!.id)"
            :key="edge.id"
            class="block break-all text-left text-[var(--accent)]"
            @click="select(edge.source)"
          >
            {{ snapshot.graph.nodes.find((n) => n.id === edge.source)?.name }}
          </button>
          <h4>{{ t('intelligence.downstream') }}</h4>
          <button
            v-for="edge in snapshot.graph.edges.filter((e) => e.source === selected!.id)"
            :key="edge.id"
            class="block break-all text-left text-[var(--accent)]"
            @click="select(edge.target)"
          >
            {{ snapshot.graph.nodes.find((n) => n.id === edge.target)?.name }}
          </button>
        </template>
      </aside>
    </div>
    <Dialog v-model:open="sourceOpen" :title="source?.path ?? t('intelligence.source')" large
      ><div v-if="source" class="h-[60vh] min-h-0" data-testid="architecture-code">
        <FileViewer
          :key="source.path"
          :source-path="source.path"
          :source-line="source.line"
          readonly
        /></div
    ></Dialog>
  </section>
</template>

<style scoped>
.intelligence {
  container-type: inline-size;
}
.intelligence :deep(.ui-button) {
  max-width: 100%;
  height: auto;
  min-height: var(--height-button);
  white-space: normal;
  overflow-wrap: anywhere;
  padding-top: 4px;
  padding-bottom: 4px;
}
.architecture-layout {
  display: grid;
  grid-template-columns: minmax(150px, 20%) minmax(0, 1fr) minmax(180px, 24%);
}
@container (max-width: 740px) {
  .architecture-layout {
    grid-template-columns: 150px minmax(0, 1fr);
  }
  .architecture-layout > aside:last-child {
    grid-column: 1/-1;
    max-height: 180px;
    border-top: 1px solid var(--border-subtle);
  }
}
@container (max-width: 560px) {
  .architecture-layout {
    grid-template-columns: minmax(0, 1fr);
    overflow: auto;
  }
  .architecture-layout > aside:first-child {
    max-height: 160px;
  }
  .architecture-layout > main {
    min-height: 500px;
  }
  .architecture-layout > aside:last-child {
    max-height: 240px;
  }
}
</style>
