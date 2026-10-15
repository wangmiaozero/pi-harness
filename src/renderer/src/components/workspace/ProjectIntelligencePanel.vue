<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Network, PanelLeft, ChevronDown } from '@lucide/vue'
import { getApi, getErrorPayload } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { useSettingsStore } from '@renderer/stores/settings'
import { startupAnimationVisible } from '@renderer/startup'
import { themeAppearance } from '@shared/constants/theme'
import { getActiveVisualSkin } from '@renderer/utils/visual-skin'
import { readArchitecturePalette } from '@renderer/utils/architecture-palette'
import { resolveAppLocale } from '@shared/constants/language'
import { architectureLabel, architectureWarning } from '@renderer/i18n/intelligence-details'
import Button from '@renderer/components/ui/Button.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import type {
  AnalysisState,
  ArchitectureSnapshot,
  ArchitectureMap
} from '@shared/intelligence/schema'

const FileViewer = defineAsyncComponent(() => import('@renderer/components/files/FileViewer.vue'))

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
const analysisOptionsOpen = ref(false)
const moduleListOpen = ref(true)
const detailsOpen = ref(false)
const panel = ref<HTMLElement | null>(null)
const fullscreen = ref(false)
function onFullscreenChange(): void {
  fullscreen.value = document.fullscreenElement === panel.value
  void nextTick(() => viewerMessage())
}
document.addEventListener('fullscreenchange', onFullscreenChange)
let mapVersion = 0
const viewerUrl = computed(() => map.value?.viewerUrl ?? snapshot.value?.viewerUrl ?? null)
const visibleWarnings = computed(() =>
  (snapshot.value?.graph.warnings ?? []).filter(
    (warning) => !viewerUrl.value || !warning.startsWith('The architecture viewer')
  )
)
const visibleModuleIds = computed(
  () => map.value?.moduleIds ?? snapshot.value?.graph.nodes.slice(0, 48).map((n) => n.id) ?? []
)
const mapOffset = computed(() => map.value?.offset ?? 0)
const viewerControls = computed(() => ({
  range:
    snapshot.value && snapshot.value.graph.nodes.length > 48
      ? `${mapOffset.value + 1}–${Math.min(mapOffset.value + 48, snapshot.value.graph.nodes.length)} / ${snapshot.value.graph.nodes.length}`
      : '',
  focused: Boolean(map.value?.focus),
  previousDisabled: mapBusy.value || mapOffset.value === 0,
  nextDisabled: mapBusy.value || mapOffset.value + 48 >= (snapshot.value?.graph.nodes.length ?? 0),
  busy: mapBusy.value,
  fullscreen: fullscreen.value,
  labels: {
    previous: t('intelligence.previousMap'),
    next: t('intelligence.nextMap'),
    overview: t('intelligence.overview'),
    fullscreen: t('intelligence.fullscreen'),
    exitFullscreen: t('intelligence.exitFullscreen')
  }
}))
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
const theme = computed(
  () =>
    getActiveVisualSkin(settings.settings)?.appearance ??
    themeAppearance(settings.settings?.theme ?? 'dark')
)
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
      url:
        startupAnimationVisible.value || sourceOpen.value || dialogBlocking.value
          ? null
          : viewerUrl.value,
      bounds: {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.max(0, Math.round(right - left)),
        height: Math.max(0, Math.round(bottom - top))
      },
      theme: theme.value,
      palette: readArchitecturePalette(),
      controls: viewerControls.value,
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
  error.value = null
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
    if (version === revision && requestVersion === mapVersion) {
      const payload = getErrorPayload(e)
      error.value =
        payload.code === 'PROCESS_FAILED' ? t('intelligence.renderFailed') : payload.message
    }
  } finally {
    if (version === revision && requestVersion === mapVersion) mapBusy.value = false
  }
}
function select(id: string): void {
  selectedId.value = id
  detailsOpen.value = true
  if (!visibleModuleIds.value.includes(id)) void showMap(0, id)
  else void viewerMessage(id)
}
const unsubscribe = getApi().on('architecture-selected', (input) => {
  const value = input as { url?: unknown; id?: unknown }
  if (value.url !== viewerUrl.value || typeof value.id !== 'string') return
  if (snapshot.value?.graph.nodes.some((n) => n.id === value.id)) {
    selectedId.value = value.id
    detailsOpen.value = true
  }
})
const unsubscribeControls = getApi().on('architecture-control', (input) => {
  const value = input as { url?: unknown; action?: unknown }
  if (value.url !== viewerUrl.value) return
  if (value.action === 'fullscreen-error') error.value = t('intelligence.fullscreenError')
  if (mapBusy.value) return
  if (value.action === 'previous' && !map.value?.focus && !viewerControls.value.previousDisabled)
    void showMap(mapOffset.value - 48)
  if (value.action === 'next' && !map.value?.focus && !viewerControls.value.nextDisabled)
    void showMap(mapOffset.value + 48)
  if (value.action === 'overview' && map.value?.focus) void showMap()
})
watch(
  [theme, sourceOpen, dialogBlocking, startupAnimationVisible, viewerControls],
  () => void viewerMessage()
)
watch(
  () => settings.settings,
  () => void viewerMessage(),
  { flush: 'post' }
)
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
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (document.fullscreenElement === panel.value)
    void document.exitFullscreen().catch(() => undefined)
  revision++
  nativeVersion++
  mapVersion++
  if (timer) clearTimeout(timer)
  resize?.disconnect()
  window.removeEventListener('scroll', onScroll, true)
  cancelAnimationFrame(scrollFrame)
  unsubscribe()
  unsubscribeControls()
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
    id="pi-architecture-panel"
    ref="panel"
    class="intelligence flex h-full min-h-0 flex-col overflow-hidden"
    :class="{ 'intelligence--fullscreen': fullscreen }"
    data-testid="project-intelligence"
  >
    <header
      class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border-subtle)] px-2 py-1.5 text-xs"
    >
      <Network class="size-4 shrink-0" />
      <h2 class="font-semibold">{{ t('intelligence.title') }}</h2>
      <IconButton
        v-if="snapshot"
        :label="t('intelligence.modules')"
        :active="moduleListOpen"
        :aria-expanded="moduleListOpen"
        aria-controls="architecture-module-browser"
        data-testid="architecture-toggle-modules"
        @click="moduleListOpen = !moduleListOpen"
      >
        <PanelLeft class="size-3.5" />
      </IconButton>
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
    <div
      class="architecture-analysisbar shrink-0 border-b border-[var(--border-subtle)] px-2 py-1.5 text-xs"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <select
          v-if="(projects?.length ?? 0) > 1"
          data-testid="architecture-project"
          class="max-w-full rounded-[var(--radius-sm)] bg-[var(--bg-input)] px-2 py-1 sm:max-w-80"
          :aria-label="t('intelligence.project')"
          :title="root ?? ''"
          :value="root"
          @change="emit('select-project', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="project in projects" :key="project" :value="project">{{ project }}</option>
        </select>
        <p v-else class="min-w-0 max-w-full truncate font-medium" :title="root ?? ''">
          {{ root?.split(/[\\/]/).filter(Boolean).at(-1) || t('intelligence.noProject') }}
        </p>
        <Button
          v-if="root"
          size="sm"
          :aria-expanded="analysisOptionsOpen"
          aria-controls="architecture-analysis-options"
          data-testid="architecture-analysis-options-toggle"
          @click="analysisOptionsOpen = !analysisOptionsOpen"
          >{{ t('intelligence.analysisOptions') }}</Button
        >
        <p role="status" data-testid="architecture-status" class="text-[var(--text-secondary)]">
          {{
            t(
              state.waiting
                ? 'intelligence.waiting'
                : `intelligence.phases.${state.phase === 'idle' && snapshot ? 'completed' : state.phase}`
            )
          }}
          · {{ state.phase === 'idle' && snapshot ? snapshot.graph.coverage.files : state.files }}
          {{ t('intelligence.files') }}
        </p>
      </div>
      <div
        v-show="analysisOptionsOpen"
        id="architecture-analysis-options"
        class="mt-2 max-h-48 space-y-2 overflow-auto border-t border-[var(--border-subtle)] pt-2"
      >
        <p>{{ t('intelligence.localHint') }}</p>
        <div v-if="root" class="flex flex-wrap items-center gap-2">
          <Switch v-model="ai" :disabled="running" :label="t('intelligence.ai')" /><span>{{
            t('intelligence.ai')
          }}</span>
          <span class="text-[var(--text-secondary)]"
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
            class="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] p-1.5"
            :aria-label="t('intelligence.excludes')"
            @input="root && excludeDrafts.set(root, ($event.target as HTMLTextAreaElement).value)"
          />
        </details>
      </div>
      <p v-if="error" role="alert" class="mt-1 text-[var(--error)]">{{ error }}</p>
    </div>
    <div
      v-if="!snapshot"
      class="flex flex-1 items-center justify-center p-8 text-[var(--text-secondary)]"
    >
      {{ t('intelligence.empty') }}
    </div>
    <div v-else class="architecture-layout min-h-0 flex-1">
      <aside
        v-show="moduleListOpen"
        id="architecture-module-browser"
        data-testid="architecture-module-browser"
        class="architecture-modules min-h-0 space-y-2 overflow-auto border-r border-[var(--border-subtle)] p-2"
      >
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
      <main class="flex min-h-0 min-w-0 flex-1 flex-col">
        <details
          class="architecture-summary shrink-0 border-b border-[var(--border-subtle)] px-2 py-1.5 text-xs"
          data-testid="architecture-summary"
        >
          <summary class="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-medium">{{ t('intelligence.summary') }}</span>
            <span class="text-[var(--text-secondary)]"
              >{{ snapshot.graph.nodes.length }} {{ t('intelligence.modules') }} ·
              {{ snapshot.graph.edges.length }} {{ t('intelligence.relationships') }}</span
            >
            <span
              :title="
                t(
                  `intelligence.${snapshot.staleness === 'fresh' ? 'fresh' : snapshot.staleness === 'stale' ? 'stale' : 'unknown'}`
                )
              "
              :class="
                snapshot.staleness === 'fresh'
                  ? 'text-[var(--text-secondary)]'
                  : 'text-[var(--warning)]'
              "
              >{{
                t(
                  `intelligence.${snapshot.staleness === 'fresh' ? 'fresh' : snapshot.staleness === 'stale' ? 'staleStatus' : 'unknownStatus'}`
                )
              }}</span
            >
            <ChevronDown class="ml-auto size-3 shrink-0" />
          </summary>
          <div class="max-h-40 space-y-1 overflow-auto py-2">
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
                      files: snapshot.graph.coverage.files,
                      imports: snapshot.graph.edges.length,
                      packages: snapshot.graph.project.packages.length
                    })
              }}
            </p>
            <p>
              {{ snapshot.graph.project.languages.join(', ') }} ·
              {{ snapshot.graph.project.frameworks.join(', ') }}
            </p>
            <details v-if="snapshot.graph.analysis" data-testid="architecture-language-coverage">
              <summary>{{ t('intelligence.coverageLabel') }}</summary>
              <p v-for="coverage in snapshot.graph.analysis.languages" :key="coverage.language">
                {{ coverage.language }} · {{ coverage.files }} ·
                {{
                  t(
                    coverage.imports === 'file-index-only' || coverage.imports === 'unknown'
                      ? 'intelligence.fileIndexOnly'
                      : 'intelligence.staticDependencies'
                  )
                }}
                · {{ t('intelligence.unresolvedDependencies', { count: coverage.unresolved }) }} ·
                {{ t('intelligence.callsUnknown') }}
              </p>
            </details>
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
            <details v-if="visibleWarnings.length">
              <summary>
                {{
                  snapshot.graph.coverage.partial
                    ? t('intelligence.partial')
                    : t('intelligence.confidence')
                }}
                ({{ visibleWarnings.length }})
              </summary>
              <p
                v-for="warning in visibleWarnings"
                :key="warning"
                class="mt-1 text-[var(--text-secondary)]"
              >
                {{ architectureWarning(warning, locale) }}
              </p>
            </details>
          </div>
        </details>
        <div
          v-if="viewerUrl"
          ref="viewer"
          :key="viewerUrl"
          class="min-h-[240px] w-full flex-1"
          data-testid="architecture-viewer"
          :aria-label="t('intelligence.architecture')"
        />
        <div v-else class="space-y-3 p-6 text-sm">
          <p>{{ t('intelligence.noViewer') }}</p>
          <Button
            data-testid="architecture-retry-map"
            :disabled="mapBusy || running || !snapshot.graph.nodes.length"
            @click="showMap()"
            >{{ mapBusy ? t('intelligence.phases.rendering') : t('intelligence.retryMap') }}</Button
          >
        </div>
      </main>
      <aside
        v-if="selected && detailsOpen"
        data-testid="architecture-module-details"
        class="architecture-details min-h-0 space-y-2 overflow-auto border-l border-[var(--border-subtle)] p-2 text-xs"
      >
        <div class="flex items-center gap-2">
          <h3 class="min-w-0 flex-1 break-all font-semibold">{{ selected.name }}</h3>
          <IconButton
            :label="t('common.close')"
            data-testid="architecture-close-details"
            @click="detailsOpen = false"
          />
        </div>
        <template v-if="selected">
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
  --architecture-surface: color-mix(in srgb, var(--bg-window) 78%, var(--bg-surface-raised));
  container-type: inline-size;
  background: color-mix(in srgb, var(--architecture-surface) 32%, transparent);
}
/* Each reading surface blurs the scene independently, without filtering the native canvas. */
.intelligence > header,
.architecture-analysisbar,
.architecture-modules,
.architecture-details,
.architecture-summary {
  background: color-mix(in srgb, var(--architecture-surface) 86%, transparent);
  backdrop-filter: blur(24px) saturate(0.85);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text-primary) 5%, transparent);
}
@supports not (backdrop-filter: blur(1px)) {
  .intelligence > header,
  .architecture-analysisbar,
  .architecture-modules,
  .architecture-details,
  .architecture-summary {
    background: var(--architecture-surface);
  }
}
@media (prefers-reduced-transparency: reduce) {
  .intelligence > header,
  .architecture-analysisbar,
  .architecture-modules,
  .architecture-details,
  .architecture-summary {
    background: var(--architecture-surface);
    backdrop-filter: none;
  }
}
.intelligence:fullscreen {
  width: 100vw;
  height: 100vh;
  background: var(--bg-workspace);
}
.intelligence--fullscreen > header,
.intelligence--fullscreen .architecture-analysisbar,
.intelligence--fullscreen .architecture-modules,
.intelligence--fullscreen .architecture-details,
.intelligence--fullscreen .architecture-summary {
  display: none;
}
.intelligence :deep(.ui-button) {
  max-width: 100%;
  height: auto;
  min-height: 26px;
  font-size: 11px;
  white-space: normal;
  overflow-wrap: anywhere;
  padding-top: 4px;
  padding-bottom: 4px;
}
.architecture-layout {
  display: flex;
}
.architecture-modules {
  width: clamp(150px, 18%, 190px);
  flex-shrink: 0;
}
.architecture-details {
  width: clamp(180px, 24%, 240px);
  flex-shrink: 0;
}
.architecture-summary > summary {
  list-style: none;
}
.architecture-summary > summary::-webkit-details-marker {
  display: none;
}
.architecture-summary[open] > summary > svg {
  transform: rotate(180deg);
}
@container (max-width: 560px) {
  .architecture-modules {
    width: 140px;
  }
  .architecture-details {
    width: 160px;
  }
}
</style>
