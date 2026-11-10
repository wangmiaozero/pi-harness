<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, LoaderCircle } from '@lucide/vue'
import { toast } from 'vue-sonner'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import MarketPackageCard from '@renderer/components/settings/MarketPackageCard.vue'
import { actionPackInfo, compareMarketPackageNames, localizedText, packageDisplayName } from '@renderer/market/display'
import { themePackForStyle } from '@shared/market/style-packs'
import { getApi } from '@renderer/composables/useApi'
import { reloadInstalledCatalog } from '@renderer/market/catalog'
import { useSettingsStore } from '@renderer/stores/settings'
import { applyVisualSkin, selectedThemePackMissing } from '@renderer/utils/visual-skin'
import { DEFAULT_MASCOT_STYLE } from '@shared/constants/mascot'
import { MASCOT_ENABLED } from '@shared/feature-flags'
import type { MascotStyle } from '@shared/constants/mascot'
import { marketFileUrl } from '@shared/market/urls'
import type {
  InstalledMarketPackage,
  MarketInstalled,
  MarketPackageSummary,
  MarketProgress,
  MarketSearchResult
} from '@shared/market/types'

const { t, locale } = useI18n()
const store = useSettingsStore()
const tab = ref<'theme' | 'pet' | 'installed'>('theme')
const query = ref('')
const searchResult = ref<MarketSearchResult | null>(null)
const installed = ref<MarketInstalled | null>(null)
const progress = ref<Record<string, MarketProgress>>({})
const busy = ref('')
const error = ref('')
const loading = ref(false)
let loadGeneration = 0

const visibleTabs = computed(() =>
  MASCOT_ENABLED
    ? (['theme', 'pet', 'installed'] as const)
    : (['theme', 'installed'] as const)
)

const cards = computed(() => {
  if (tab.value === 'installed') return []
  return [...(searchResult.value?.packages ?? [])].sort((a, b) =>
    compareMarketPackageNames(a.name, b.name)
  )
})

const installedCards = computed(() => {
  if (!installed.value || tab.value !== 'installed') return []
  const byName = (a: InstalledMarketPackage, b: InstalledMarketPackage) =>
    compareMarketPackageNames(a.name, b.name)
  const all = [...[...installed.value.themes].sort(byName), ...[...installed.value.pets].sort(byName)]
  const names = new Set(all.map((item) => item.name))
  return all.filter((item) => {
    const action = actionPackInfo(item.name)
    return !action || !names.has(action.parent)
  })
})

const actionPacksByParent = computed(() => {
  const groups: Record<string, InstalledMarketPackage[]> = {}
  for (const item of installed.value?.pets ?? []) {
    const action = actionPackInfo(item.name)
    if (!action) continue
    ;(groups[action.parent] ??= []).push(item)
  }
  for (const list of Object.values(groups)) {
    list.sort((a, b) => compareMarketPackageNames(a.name, b.name))
  }
  return groups
})

const expandedGroups = ref<Record<string, boolean>>({})

function displayName(name: string, manifestName?: string | null): string {
  return packageDisplayName(name, locale.value, (key, values) => t(key, values), manifestName)
}

function description(value: string | undefined | null): string {
  return value ? localizedText(value, locale.value) : ''
}

function cardKind(name: string, kind: 'theme' | 'pet'): 'theme' | 'pet' | 'action' {
  return actionPackInfo(name) ? 'action' : kind
}

function kindLabel(name: string, kind: 'theme' | 'pet'): string {
  const value = cardKind(name, kind)
  return t(
    value === 'theme'
      ? 'settings.marketKindTheme'
      : value === 'pet'
        ? 'settings.marketKindPet'
        : 'settings.marketKindActionPack'
  )
}

function inUse(item: InstalledMarketPackage): boolean {
  const settings = store.settings
  if (!settings) return false
  if (item.kind === 'theme') {
    return !settings.customSkinId && themePackForStyle(settings.mascotStyle) === item.packId
  }
  return Boolean(
    item.petId && settings.desktopPet.enabled && settings.desktopPet.activePackId === item.petId
  )
}

function catalogPreview(item: MarketPackageSummary): string | null {
  const local = installedPackage(item.name)
  return local ? preview(local) : null
}

function catalogMeta(item: MarketPackageSummary): string[] {
  return [
    item.version ? `v${item.version}` : '',
    item.unpackedSize ? bytes(item.unpackedSize) : '',
    item.license,
    item.compatible === false ? t('settings.marketIncompatible') : '',
    item.deprecated ? t('settings.marketDeprecated') : ''
  ]
}

function installedMeta(item: InstalledMarketPackage): string[] {
  return [
    `v${item.version}`,
    item.updateAvailable && item.latest ? `${t('settings.marketLatest')} v${item.latest}` : '',
    item.license
  ]
}

function installedPackage(name: string): InstalledMarketPackage | null {
  const items = [...(installed.value?.themes ?? []), ...(installed.value?.pets ?? [])]
  return items.find((item) => item.name === name) ?? null
}

function bytes(value: number | null): string {
  if (!value || value < 0) return '—'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function load(refresh = false): Promise<void> {
  const generation = ++loadGeneration
  const requested = tab.value
  loading.value = true
  error.value = ''
  if (requested !== 'installed') searchResult.value = null
  try {
    const installedPromise = refresh ? getApi().market.refresh() : getApi().market.installed()
    const searchPromise =
      requested === 'installed' ? null : getApi().market.search(query.value, requested, refresh)
    const nextInstalled = await installedPromise
    if (generation !== loadGeneration) return
    installed.value = nextInstalled
    if (searchPromise) {
      const nextSearch = await searchPromise
      if (generation !== loadGeneration) return
      searchResult.value = nextSearch
    }
  } catch (reason) {
    if (generation !== loadGeneration) return
    error.value = message(reason)
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

async function install(name: string, version?: string): Promise<void> {
  busy.value = name
  error.value = ''
  try {
    await getApi().market.install(name, version)
    installed.value = await reloadInstalledCatalog()
    applyVisualSkin(store.settings)
    toast.success(displayName(name))
  } catch (reason) {
    error.value = message(reason)
    toast.error(t('settings.marketFailed'), { description: error.value })
  } finally {
    busy.value = ''
  }
}

async function uninstall(name: string): Promise<void> {
  busy.value = name
  error.value = ''
  try {
    await getApi().market.uninstall(name)
    installed.value = await reloadInstalledCatalog()
    if (selectedThemePackMissing(store.settings)) {
      await store.patch({ mascotStyle: DEFAULT_MASCOT_STYLE })
    }
    toast.success(displayName(name))
  } catch (reason) {
    error.value = message(reason)
    toast.error(t('settings.marketFailed'), { description: error.value })
  } finally {
    busy.value = ''
  }
}

async function applyTheme(item: InstalledMarketPackage): Promise<void> {
  const style = item.manifest?.variants[0]?.id
  if (!style || !store.settings) return
  await store.patch({ mascotStyle: style as MascotStyle, mascotUnlocked: true })
}

async function enablePet(item: InstalledMarketPackage): Promise<void> {
  if (!item.petId || !store.settings) return
  await store.patch({
    desktopPet: { ...store.settings.desktopPet, enabled: true, activePackId: item.petId }
  })
}

function percent(name: string): string {
  const current = progress.value[name]
  if (!current?.total) return '30%'
  return `${Math.min(100, (current.received / current.total) * 100)}%`
}

function preview(item: InstalledMarketPackage): string | null {
  const file = item.manifest?.preview
  if (!file) return null
  try {
    return marketFileUrl(item.kind, item.packId, file)
  } catch {
    return null
  }
}

function selectTab(next: 'theme' | 'pet' | 'installed'): void {
  tab.value = next
  void load(false)
}

let stopProgress: (() => void) | undefined

onMounted(() => {
  stopProgress = getApi().on('market-progress', (payload) => {
    if (payload.phase === 'done' || payload.phase === 'cancelled' || payload.phase === 'error') {
      const next = { ...progress.value }
      delete next[payload.name]
      progress.value = next
      return
    }
    progress.value = { ...progress.value, [payload.name]: payload }
  })
  void load(false)
})

onUnmounted(() => stopProgress?.())
</script>

<template>
  <section
    class="space-y-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
    data-testid="resource-market-section"
  >
    <div class="market-toolbar" data-testid="market-toolbar">
      <div class="market-tabs" role="tablist">
        <button
          v-for="item in visibleTabs"
          :key="item"
          type="button"
          role="tab"
          class="market-tab"
          :class="{ 'market-tab-active': tab === item }"
          :aria-selected="tab === item"
          :data-testid="`market-tab-${item}`"
          @click="selectTab(item)"
        >
          {{ t(item === 'theme' ? 'settings.marketThemes' : item === 'pet' ? 'settings.marketPets' : 'settings.marketInstalled') }}
        </button>
      </div>
      <div v-if="tab !== 'installed'" class="market-search min-w-0 flex-1">
        <Input
          v-model="query"
          :placeholder="t('settings.marketSearch')"
          @keydown.enter="load(true)"
        />
      </div>
      <span v-else class="flex-1" />
      <Button size="sm" variant="ghost" class="shrink-0" @click="load(true)">
        {{ t('settings.marketRefresh') }}
      </Button>
    </div>

    <p v-if="searchResult?.offline" class="text-[12px] text-[var(--text-secondary)]">
      {{ t('settings.marketOffline') }}
    </p>
    <p v-if="searchResult?.incomplete" class="text-[12px] text-[var(--text-secondary)]">
      {{ t('settings.marketIncomplete') }}
    </p>
    <p v-if="error" class="text-[12px] text-[var(--danger,var(--text-secondary))]">{{ error }}</p>

    <p
      v-if="loading"
      class="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]"
      data-testid="resource-market-loading"
    >
      <LoaderCircle class="size-3.5 animate-spin motion-reduce:animate-none" :stroke-width="1.75" />
      {{ t('settings.marketLoading') }}
    </p>

    <template v-else-if="tab !== 'installed'">
      <p v-if="cards.length === 0" class="text-[12px] text-[var(--text-tertiary)]">
        {{ t('settings.marketEmpty') }}
      </p>
      <div v-else class="market-grid" data-testid="market-catalog-grid">
        <MarketPackageCard
          v-for="item in cards"
          :key="item.name"
          :data-market-package="item.name"
          :title="displayName(item.name, installedPackage(item.name)?.manifest?.name)"
          :kind="cardKind(item.name, item.kind)"
          :kind-label="kindLabel(item.name, item.kind)"
          :preview="catalogPreview(item)"
          :description="description(item.description)"
          :meta="catalogMeta(item)"
          :in-use="installedPackage(item.name) ? inUse(installedPackage(item.name)!) : false"
          :in-use-label="t('settings.marketInUse')"
          :progress="progress[item.name] ? percent(item.name) : null"
        >
          <template #actions>
            <template v-if="progress[item.name]">
              <span class="text-[11px] text-[var(--text-tertiary)]">{{ t('settings.marketInstalling') }}</span>
              <Button
                v-if="progress[item.name].phase === 'download'"
                size="sm"
                variant="ghost"
                @click="getApi().market.cancel(item.name)"
              >
                {{ t('settings.marketCancel') }}
              </Button>
            </template>
            <Button
              v-else-if="installedPackage(item.name)"
              size="sm"
              variant="ghost"
              :disabled="busy === item.name"
              @click="uninstall(item.name)"
            >
              {{ t('settings.marketUninstall') }}
            </Button>
            <Button
              v-else
              size="sm"
              variant="primary"
              :disabled="busy === item.name || item.compatible === false"
              @click="install(item.name, item.version || undefined)"
            >
              {{ t('settings.marketInstall') }}
            </Button>
          </template>
        </MarketPackageCard>
      </div>
    </template>

    <template v-else>
      <p v-if="installedCards.length === 0" class="text-[12px] text-[var(--text-tertiary)]">
        {{ t('settings.marketEmpty') }}
      </p>
      <div v-else class="market-grid market-grid-installed" data-testid="market-installed-grid">
        <MarketPackageCard
          v-for="item in installedCards"
          :key="item.name"
          :data-market-installed="item.name"
          :title="displayName(item.name, item.manifest?.name)"
          :kind="cardKind(item.name, item.kind)"
          :kind-label="kindLabel(item.name, item.kind)"
          :preview="preview(item)"
          :description="description(item.manifest?.description)"
          :meta="installedMeta(item)"
          :in-use="inUse(item)"
          :in-use-label="t('settings.marketInUse')"
          :progress="progress[item.name] ? percent(item.name) : null"
        >
          <template #actions>
            <Button
              v-if="item.updateAvailable && item.latest"
              size="sm"
              variant="primary"
              :disabled="busy === item.name"
              @click="install(item.name, item.latest)"
            >
              {{ t('settings.marketUpdate') }}
            </Button>
            <Button
              v-if="item.kind === 'theme'"
              size="sm"
              variant="secondary"
              :disabled="inUse(item)"
              @click="applyTheme(item)"
            >
              {{ t('settings.marketApply') }}
            </Button>
            <Button
              v-else-if="MASCOT_ENABLED && item.petId"
              size="sm"
              variant="secondary"
              :disabled="inUse(item)"
              @click="enablePet(item)"
            >
              {{ t('settings.marketEnable') }}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              :disabled="busy === item.name"
              @click="uninstall(item.name)"
            >
              {{ t('settings.marketUninstall') }}
            </Button>
          </template>
          <div
            v-if="actionPacksByParent[item.name]?.length"
            class="mt-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
            data-testid="market-action-packs"
          >
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              :aria-expanded="Boolean(expandedGroups[item.name])"
              data-testid="market-action-packs-toggle"
              @click="expandedGroups[item.name] = !expandedGroups[item.name]"
            >
              {{ t('settings.marketActionPacks', { count: actionPacksByParent[item.name].length }) }}
              <ChevronDown
                class="size-3.5 transition-transform"
                :class="{ 'rotate-180': expandedGroups[item.name] }"
                :stroke-width="1.75"
              />
            </button>
            <ul
              v-if="expandedGroups[item.name]"
              class="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]"
            >
              <li
                v-for="part in actionPacksByParent[item.name]"
                :key="part.name"
                class="flex items-center justify-between gap-2 px-2.5 py-1.5"
                :data-market-action-pack="part.name"
              >
                <div class="min-w-0">
                  <div class="truncate text-[11.5px] text-[var(--text-primary)]">
                    {{ displayName(part.name) }}
                  </div>
                  <div class="text-[10px] text-[var(--text-tertiary)]">
                    {{ installedMeta(part).filter(Boolean).join(' · ') }}
                  </div>
                </div>
                <div class="flex shrink-0 gap-1">
                  <Button
                    v-if="part.updateAvailable && part.latest"
                    size="sm"
                    variant="primary"
                    :disabled="busy === part.name"
                    @click="install(part.name, part.latest)"
                  >
                    {{ t('settings.marketUpdate') }}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    :disabled="busy === part.name"
                    @click="uninstall(part.name)"
                  >
                    {{ t('settings.marketUninstall') }}
                  </Button>
                </div>
              </li>
            </ul>
          </div>
        </MarketPackageCard>
      </div>
    </template>
  </section>
</template>

<style scoped>
.market-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.market-tabs {
  display: inline-flex;
  flex: none;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}

.market-tab {
  height: 24px;
  padding: 0 12px;
  border-radius: calc(var(--radius-sm) - 2px);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition:
    background-color var(--motion-fast, 120ms),
    color var(--motion-fast, 120ms);
}

.market-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.market-tab:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.market-tab-active,
.market-tab-active:hover {
  background: var(--accent);
  color: var(--text-on-accent, #fff);
}

.market-search {
  flex-basis: 220px;
}

.market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.market-grid-installed {
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}
</style>
