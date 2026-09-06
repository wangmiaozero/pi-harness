<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  Package as PackageIcon,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  Trash2
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import type {
  PiPackageInfo,
  PiPackageScope,
  PiRegistryPackage,
  PiRegistryPackageType
} from '@shared/ipc/api-types'
import Badge from '@renderer/components/ui/Badge.vue'
import Button from '@renderer/components/ui/Button.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import SearchField from '@renderer/components/ui/SearchField.vue'
import Select from '@renderer/components/ui/Select.vue'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { useSkillsStore } from '@renderer/stores/skills'
import { useWorkspaceStore } from '@renderer/stores/workspace'

const { t, locale } = useI18n()
const store = useSkillsStore()
const workspace = useWorkspaceStore()
const search = ref(store.registryQuery)
const selectedName = ref<string | null>(null)
const installScope = ref<PiPackageScope>('global')
const detailLoading = ref(false)
const detailError = ref<string | null>(null)
const mutationBusy = ref(false)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const selectedPackage = computed(() =>
  store.registryPackages.find((pkg) => pkg.name === selectedName.value)
)
const selectedDetail = computed(() =>
  selectedName.value ? store.registryDetails[selectedName.value] : undefined
)
const totalPages = computed(() => Math.ceil(store.registryTotal / store.registryPageSize))
const rangeStart = computed(() =>
  store.registryTotal ? (store.registryPage - 1) * store.registryPageSize + 1 : 0
)
const rangeEnd = computed(() =>
  Math.min(store.registryPage * store.registryPageSize, store.registryTotal)
)
const scopeOptions = computed(() => [
  { value: 'global', label: t('capabilities.globalScope') },
  {
    value: 'project',
    label: t('capabilities.projectScope'),
    disabled: !workspace.currentCwd
  }
])
const sortOptions = computed(() => [
  { value: 'relevance', label: t('capabilities.relevance') },
  { value: 'downloads', label: t('capabilities.mostDownloaded') },
  { value: 'published', label: t('capabilities.recentlyPublished') }
])
const typeOptions = computed(
  () =>
    [
      ['all', 'capabilities.all'],
      ['extension', 'capabilities.extensions'],
      ['skill', 'capabilities.skillsType'],
      ['prompt', 'capabilities.prompts'],
      ['theme', 'capabilities.themes']
    ] as const
)

watch(search, (value) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void runSearch({ query: value, page: 1 })
  }, 400)
})

watch(
  () => store.registryType,
  () => void runSearch({ page: 1 })
)

watch(
  () => store.registrySort,
  () => void runSearch({ page: 1 })
)

watch(
  () => workspace.currentCwd,
  (cwd) => {
    if (!cwd && installScope.value === 'project') installScope.value = 'global'
  }
)

onMounted(async () => {
  if (!store.registryPackages.length) await runSearch()
  else if (!selectedName.value && store.registryPackages[0]) {
    await selectPackage(store.registryPackages[0])
  }
})

async function runSearch(input: { query?: string; page?: number; refresh?: boolean } = {}) {
  try {
    await store.searchRegistry(input)
    const current = store.registryPackages.find((pkg) => pkg.name === selectedName.value)
    const next = current ?? store.registryPackages[0]
    if (next) await selectPackage(next)
    else selectedName.value = null
  } catch {
    // The store owns the localized error-state surface.
  }
}

async function selectPackage(pkg: PiRegistryPackage, refresh = false) {
  selectedName.value = pkg.name
  detailError.value = null
  if (store.registryDetails[pkg.name] && !refresh) return
  detailLoading.value = true
  try {
    await store.loadRegistryDetail(pkg.name, refresh)
  } catch (error) {
    detailError.value = (error as { message?: string }).message ?? String(error)
  } finally {
    detailLoading.value = false
  }
}

function installedPackage(pkg: PiRegistryPackage | undefined): PiPackageInfo | undefined {
  if (!pkg) return undefined
  return store.packages.find(
    (candidate) =>
      candidate.sourceType === 'npm' &&
      npmPackageName(candidate.source) === pkg.name &&
      candidate.registered
  )
}

function updateFor(pkg: PiRegistryPackage | undefined) {
  const installed = installedPackage(pkg)
  return installed ? store.packageUpdates[installed.id] : undefined
}

async function install(pkg: PiRegistryPackage) {
  const confirmed = await askConfirm({
    title: t('capabilities.installTitle', { name: pkg.name }),
    description: t('capabilities.thirdPartyNotice'),
    confirmLabel: t('capabilities.install'),
    tone: 'primary'
  })
  if (!confirmed) return
  mutationBusy.value = true
  try {
    const [result] = await store.installPackages([`npm:${pkg.name}`], installScope.value)
    if (!result?.ok) throw new Error(result?.message || t('capabilities.installFailed'))
    toast.success(t('capabilities.installSuccess', { name: pkg.name }))
    await selectPackage(pkg, true)
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('capabilities.installFailed'))
  } finally {
    mutationBusy.value = false
  }
}

async function update(pkg: PiRegistryPackage) {
  const installed = installedPackage(pkg)
  if (!installed) return
  const confirmed = await askConfirm({
    title: t('capabilities.updateTitle', { name: pkg.name }),
    description: t('capabilities.updateNotice'),
    confirmLabel: t('capabilities.update'),
    tone: 'primary'
  })
  if (!confirmed) return
  mutationBusy.value = true
  try {
    const result = await store.updatePackage(installed)
    if (!result.ok) throw new Error(result.message)
    toast.success(t('capabilities.updateSuccess', { name: pkg.name }))
    await selectPackage(pkg, true)
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('capabilities.updateFailed'))
  } finally {
    mutationBusy.value = false
  }
}

async function uninstall(pkg: PiRegistryPackage) {
  const installed = installedPackage(pkg)
  if (!installed) return
  const confirmed = await askConfirm({
    title: t('capabilities.uninstallTitle', { name: pkg.name }),
    description: t('capabilities.uninstallNotice'),
    confirmLabel: t('capabilities.uninstall'),
    tone: 'danger'
  })
  if (!confirmed) return
  mutationBusy.value = true
  try {
    const result = await store.removePackage(installed)
    if (!result.ok) throw new Error(result.message)
    toast.success(t('capabilities.uninstallSuccess', { name: pkg.name }))
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('capabilities.uninstallFailed'))
  } finally {
    mutationBusy.value = false
  }
}

function setType(type: PiRegistryPackageType | 'all') {
  store.registryType = type
}

function typeLabel(type: PiRegistryPackageType): string {
  const key = {
    extension: 'capabilities.typeExtension',
    skill: 'capabilities.typeSkill',
    prompt: 'capabilities.typePrompt',
    theme: 'capabilities.typeTheme',
    package: 'capabilities.typePackage'
  } as const
  return t(key[type])
}

function typeTone(type: PiRegistryPackageType) {
  if (type === 'extension') return 'accent'
  if (type === 'skill') return 'success'
  if (type === 'prompt') return 'reasoning'
  if (type === 'theme') return 'warning'
  return 'muted'
}

function formatDownloads(value: number | null): string {
  if (value === null) return '—'
  return Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value
  )
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale.value).format(date)
}

function npmPackageName(source: string): string {
  const raw = source.replace(/^npm:/, '')
  const separator = raw.lastIndexOf('@')
  const slash = raw.startsWith('@') ? raw.indexOf('/') : -1
  return separator > Math.max(0, slash) ? raw.slice(0, separator) : raw
}

function resources(pkg: PiRegistryPackage | undefined) {
  if (!pkg) return []
  return [
    ['extension', pkg.resources.extensions],
    ['skill', pkg.resources.skills],
    ['prompt', pkg.resources.prompts],
    ['theme', pkg.resources.themes]
  ] as const
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="official-package-market">
    <div
      class="capabilities-toolbar flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2"
    >
      <div class="w-[260px] min-w-[180px]">
        <SearchField
          v-model="search"
          :placeholder="$t('capabilities.searchPlaceholder')"
          size="sm"
        />
      </div>
      <div class="flex flex-wrap items-center gap-1" role="group">
        <button
          v-for="[value, label] in typeOptions"
          :key="value"
          type="button"
          class="h-7 rounded-[var(--radius-sm)] border px-2.5 text-[11px] transition-colors"
          :class="
            store.registryType === value
              ? 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)]'
              : 'border-[var(--border-default)] bg-[var(--control-bg)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          "
          @click="setType(value)"
        >
          {{ $t(label) }}
        </button>
      </div>
      <div class="w-[158px]">
        <Select v-model="store.registrySort" :options="sortOptions" />
      </div>
      <div class="ml-auto flex items-center gap-2">
        <span class="text-[11px] text-[var(--text-tertiary)]" data-testid="registry-total">
          {{ $t('capabilities.packageCount', { count: store.registryTotal }) }}
        </span>
        <Button
          variant="ghost"
          size="sm"
          :loading="store.registryRefreshing"
          @click="runSearch({ refresh: true })"
        >
          <RefreshCw class="size-3.5" />
          {{ $t('capabilities.refresh') }}
        </Button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <section
        class="flex min-h-0 w-[420px] min-w-[340px] shrink-0 flex-col border-r border-[var(--border-subtle)]"
      >
        <div class="relative min-h-0 flex-1 overflow-y-auto p-2">
          <div
            v-if="store.registryLoading && !store.registryPackages.length"
            class="space-y-2"
            data-testid="registry-skeleton"
          >
            <div
              v-for="index in 8"
              :key="index"
              class="h-[112px] animate-pulse rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            />
          </div>
          <div
            v-else-if="store.registryError && !store.registryPackages.length"
            class="flex h-full items-center justify-center px-4"
          >
            <EmptyState
              :title="$t('capabilities.registryError')"
              :description="store.registryError"
              :icon="ShieldAlert"
            >
              <Button variant="secondary" size="sm" @click="runSearch({ refresh: true })">
                {{ $t('capabilities.retry') }}
              </Button>
            </EmptyState>
          </div>
          <EmptyState
            v-else-if="!store.registryPackages.length"
            class="mt-10"
            :title="$t('capabilities.noResults')"
            :description="$t('capabilities.noResultsHint')"
            :icon="PackageIcon"
          />
          <div v-else class="space-y-2" :class="store.registryLoading ? 'opacity-70' : ''">
            <article
              v-for="pkg in store.registryPackages"
              :key="pkg.name"
              :data-testid="`registry-package-${pkg.name}`"
              class="capability-package-card cursor-pointer rounded-[var(--radius-md)] border p-3 transition-colors"
              :class="
                selectedName === pkg.name
                  ? 'border-[var(--accent-border)] bg-[var(--accent-tint)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]'
              "
              @click="selectPackage(pkg)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <h3 class="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                    {{ pkg.name }}
                  </h3>
                  <p
                    class="mt-0.5 line-clamp-2 text-[11px] leading-[1.45] text-[var(--text-tertiary)]"
                  >
                    {{ pkg.description || $t('capabilities.noDescription') }}
                  </p>
                </div>
                <Badge v-if="updateFor(pkg)?.updateAvailable" tone="warning">
                  {{ $t('capabilities.updateAvailable') }}
                </Badge>
                <Badge v-else-if="installedPackage(pkg)" tone="success">
                  {{ $t('capabilities.installedStatus') }}
                </Badge>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge v-for="type in pkg.types" :key="type" :tone="typeTone(type)">
                  {{ typeLabel(type) }}
                </Badge>
                <span class="text-[10px] text-[var(--text-tertiary)]">{{
                  pkg.publisher || '—'
                }}</span>
                <span class="text-[10px] text-[var(--text-disabled)]">·</span>
                <span class="text-[10px] text-[var(--text-tertiary)]">v{{ pkg.version }}</span>
              </div>
              <div class="mt-2 flex items-center justify-between gap-2">
                <span class="text-[10px] text-[var(--text-tertiary)]">
                  {{ formatDownloads(pkg.monthlyDownloads) }} / {{ $t('capabilities.month') }} ·
                  {{ formatDate(pkg.publishDate) }}
                </span>
                <div class="flex items-center gap-1" @click.stop>
                  <Button variant="ghost" size="sm" @click="selectPackage(pkg)">
                    {{ $t('capabilities.details') }}
                  </Button>
                  <Button
                    v-if="updateFor(pkg)?.updateAvailable"
                    variant="primary"
                    size="sm"
                    :loading="mutationBusy && selectedName === pkg.name"
                    @click="update(pkg)"
                  >
                    {{ $t('capabilities.update') }}
                  </Button>
                  <Button
                    v-else-if="!installedPackage(pkg)"
                    variant="primary"
                    size="sm"
                    :loading="mutationBusy && selectedName === pkg.name"
                    @click="install(pkg)"
                  >
                    {{ $t('capabilities.install') }}
                  </Button>
                </div>
              </div>
              <div
                v-if="pkg.detailStatus === 'failed'"
                class="mt-2 text-[10px] text-[var(--warning)]"
              >
                {{ $t('capabilities.partialDetail') }}
              </div>
            </article>
          </div>
        </div>
        <footer
          class="flex h-10 shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-3"
        >
          <span class="text-[10.5px] text-[var(--text-tertiary)]">
            {{ rangeStart }}–{{ rangeEnd }} / {{ store.registryTotal }}
          </span>
          <div class="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              :disabled="store.registryPage <= 1 || store.registryLoading"
              :aria-label="$t('capabilities.previousPage')"
              @click="runSearch({ page: store.registryPage - 1 })"
            >
              <ArrowLeft class="size-3.5" />
            </Button>
            <span class="min-w-14 text-center text-[10.5px] text-[var(--text-secondary)]">
              {{ store.registryPage }} / {{ totalPages || 1 }}
            </span>
            <Button
              variant="ghost"
              size="sm"
              :disabled="store.registryPage >= totalPages || store.registryLoading"
              :aria-label="$t('capabilities.nextPage')"
              @click="runSearch({ page: store.registryPage + 1 })"
            >
              <ArrowRight class="size-3.5" />
            </Button>
          </div>
        </footer>
      </section>

      <section class="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div v-if="!selectedPackage" class="flex h-full items-center justify-center">
          <EmptyState
            :title="$t('capabilities.selectPackage')"
            :description="$t('capabilities.selectPackageHint')"
            :icon="PackageIcon"
          />
        </div>
        <div v-else>
          <header
            class="flex min-h-[64px] items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-2"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-[15px] font-semibold text-[var(--text-primary)]">
                  {{ selectedPackage.name }}
                </h2>
                <Badge v-for="type in selectedPackage.types" :key="type" :tone="typeTone(type)">
                  {{ typeLabel(type) }}
                </Badge>
              </div>
              <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">
                {{ selectedPackage.description || $t('capabilities.noDescription') }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <div v-if="!installedPackage(selectedPackage)" class="w-[138px]">
                <Select v-model="installScope" :options="scopeOptions" />
              </div>
              <Button
                v-if="updateFor(selectedPackage)?.updateAvailable"
                variant="primary"
                size="sm"
                :loading="mutationBusy"
                @click="update(selectedPackage)"
              >
                <RotateCw class="size-3.5" />
                {{ $t('capabilities.update') }}
              </Button>
              <Button
                v-else-if="!installedPackage(selectedPackage)"
                variant="primary"
                size="sm"
                :loading="mutationBusy"
                @click="install(selectedPackage)"
              >
                <Download class="size-3.5" />
                {{ $t('capabilities.install') }}
              </Button>
              <Button
                v-else
                variant="danger"
                size="sm"
                :loading="mutationBusy"
                @click="uninstall(selectedPackage)"
              >
                <Trash2 class="size-3.5" />
                {{ $t('capabilities.uninstall') }}
              </Button>
            </div>
          </header>

          <div
            v-if="detailLoading"
            class="flex h-48 items-center justify-center text-[12px] text-[var(--text-tertiary)]"
          >
            {{ $t('capabilities.loading') }}
          </div>
          <div
            v-else-if="detailError"
            class="m-4 rounded-[var(--radius-md)] border border-[var(--warning)]/40 bg-[var(--warning-tint)] p-4"
          >
            <p class="text-[12px] text-[var(--warning)]">{{ detailError }}</p>
            <Button
              class="mt-3"
              variant="secondary"
              size="sm"
              @click="selectPackage(selectedPackage, true)"
            >
              {{ $t('capabilities.retry') }}
            </Button>
          </div>
          <template v-else-if="selectedDetail">
            <InspectorSection>
              <template #title>{{ $t('capabilities.packageInfo') }}</template>
              <PropertyRow :label="$t('capabilities.publisher')">{{
                selectedDetail.publisher || '—'
              }}</PropertyRow>
              <PropertyRow :label="$t('capabilities.author')">{{
                selectedDetail.author || '—'
              }}</PropertyRow>
              <PropertyRow :label="$t('capabilities.latestVersion')" mono>{{
                selectedDetail.latestVersion
              }}</PropertyRow>
              <PropertyRow :label="$t('capabilities.installedVersion')" mono>
                {{ installedPackage(selectedPackage)?.version || '—' }}
              </PropertyRow>
              <PropertyRow :label="$t('capabilities.license')">{{
                selectedDetail.license || '—'
              }}</PropertyRow>
              <PropertyRow :label="$t('capabilities.monthlyDownloads')">{{
                formatDownloads(selectedDetail.monthlyDownloads)
              }}</PropertyRow>
              <PropertyRow :label="$t('capabilities.weeklyDownloads')">{{
                formatDownloads(selectedDetail.weeklyDownloads)
              }}</PropertyRow>
              <PropertyRow :label="$t('capabilities.publishDate')">{{
                formatDate(selectedDetail.publishDate)
              }}</PropertyRow>
            </InspectorSection>
            <div class="my-1 h-px bg-[var(--border-subtle)]" />
            <InspectorSection>
              <template #title>{{ $t('capabilities.links') }}</template>
              <PropertyRow :label="$t('capabilities.npm')" mono>
                <ExternalLink class="mr-1 inline size-3" />{{ selectedDetail.npmUrl }}
              </PropertyRow>
              <PropertyRow :label="$t('capabilities.repository')" mono>{{
                selectedDetail.repository || '—'
              }}</PropertyRow>
              <PropertyRow :label="$t('capabilities.homepage')" mono>{{
                selectedDetail.homepage || '—'
              }}</PropertyRow>
            </InspectorSection>
            <div class="my-1 h-px bg-[var(--border-subtle)]" />
            <InspectorSection>
              <template #title>{{ $t('capabilities.resources') }}</template>
              <div class="space-y-3 px-3 py-3">
                <div v-for="[type, values] in resources(selectedDetail)" :key="type">
                  <div class="mb-1 text-[11px] font-medium text-[var(--text-secondary)]">
                    {{ typeLabel(type) }} ({{ values.length }})
                  </div>
                  <div class="flex flex-wrap gap-1.5">
                    <Badge v-for="value in values" :key="value" tone="muted">{{ value }}</Badge>
                    <span v-if="!values.length" class="text-[10.5px] text-[var(--text-disabled)]">
                      —
                    </span>
                  </div>
                </div>
              </div>
            </InspectorSection>
            <div class="my-1 h-px bg-[var(--border-subtle)]" />
            <InspectorSection>
              <template #title>{{ $t('capabilities.securityNotice') }}</template>
              <p class="px-3 py-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                {{ $t('capabilities.thirdPartyNotice') }}
              </p>
            </InspectorSection>
            <details
              v-if="selectedDetail.piManifest"
              class="mx-3 mb-4 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)]"
            >
              <summary
                class="cursor-pointer px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)]"
              >
                {{ $t('capabilities.piManifest') }}
              </summary>
              <pre
                class="max-h-80 overflow-auto border-t border-[var(--border-subtle)] p-3 font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-secondary)]"
                >{{ JSON.stringify(selectedDetail.piManifest, null, 2) }}</pre>
            </details>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>
