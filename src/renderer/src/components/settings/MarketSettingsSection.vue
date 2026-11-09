<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle } from '@lucide/vue'
import { toast } from 'vue-sonner'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
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
  MarketProgress,
  MarketSearchResult
} from '@shared/market/types'

const { t } = useI18n()
const store = useSettingsStore()
const tab = ref<'theme' | 'pet' | 'installed'>('theme')
const query = ref('')
const searchResult = ref<MarketSearchResult | null>(null)
const installed = ref<MarketInstalled | null>(null)
const progress = ref<Record<string, MarketProgress>>({})
const busy = ref('')
const error = ref('')
const loading = ref(false)
const brokenPreviews = ref<Record<string, boolean>>({})
let loadGeneration = 0

const visibleTabs = computed(() =>
  MASCOT_ENABLED
    ? (['theme', 'pet', 'installed'] as const)
    : (['theme', 'installed'] as const)
)

const cards = computed(() => {
  if (tab.value === 'installed') return []
  return searchResult.value?.packages ?? []
})

const installedCards = computed(() => {
  if (!installed.value) return []
  return tab.value === 'installed' ? [...installed.value.themes, ...installed.value.pets] : []
})

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
    toast.success(name)
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
    toast.success(name)
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
  if (!file || brokenPreviews.value[item.name]) return null
  return marketFileUrl(item.kind, item.packId, file)
}

function markPreviewBroken(name: string): void {
  brokenPreviews.value = { ...brokenPreviews.value, [name]: true }
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
  <section class="space-y-4" data-testid="resource-market-section">
    <div class="flex flex-wrap gap-2">
      <Button
        v-for="item in visibleTabs"
        :key="item"
        size="sm"
        :variant="tab === item ? 'primary' : 'secondary'"
        @click="selectTab(item)"
      >
        {{ t(item === 'theme' ? 'settings.marketThemes' : item === 'pet' ? 'settings.marketPets' : 'settings.marketInstalled') }}
      </Button>
      <Button size="sm" variant="ghost" @click="load(true)">{{ t('settings.marketRefresh') }}</Button>
    </div>

    <Input
      v-if="tab !== 'installed'"
      v-model="query"
      :placeholder="t('settings.marketSearch')"
      @keydown.enter="load(true)"
    />

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

    <div v-else-if="tab !== 'installed'" class="space-y-3">
      <p v-if="cards.length === 0" class="text-[12px] text-[var(--text-tertiary)]">
        {{ t('settings.marketEmpty') }}
      </p>
      <article
        v-for="item in cards"
        :key="item.name"
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-3"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-[13px] font-medium">{{ item.name }}</h2>
            <p class="mt-1 text-[12px] text-[var(--text-secondary)]">{{ item.description }}</p>
          </div>
          <Button
            v-if="installedPackage(item.name)"
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
            :disabled="busy === item.name || item.compatible === false"
            @click="install(item.name, item.version || undefined)"
          >
            {{ t('settings.marketInstall') }}
          </Button>
        </div>
        <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
          <div>{{ t('settings.marketVersion') }} {{ item.version || '—' }}</div>
          <div>{{ t('settings.marketSize') }} {{ bytes(item.unpackedSize) }}</div>
          <div>{{ t('settings.marketAuthor') }} {{ item.author || '—' }}</div>
          <div>{{ t('settings.marketLicense') }} {{ item.license || '—' }}</div>
          <div>
            {{
              item.compatible === false
                ? t('settings.marketIncompatible')
                : item.compatible
                  ? t('settings.marketCompatible')
                  : '—'
            }}
          </div>
          <div v-if="item.deprecated">{{ t('settings.marketDeprecated') }}</div>
        </dl>
        <div v-if="progress[item.name]" class="mt-2">
          <div class="h-1 overflow-hidden rounded bg-[var(--bg-hover)]">
            <div
              class="h-full bg-[var(--accent)]"
              :style="{ width: percent(item.name) }"
            />
          </div>
          <Button
            v-if="progress[item.name].phase === 'download'"
            class="mt-2"
            size="sm"
            variant="ghost"
            @click="getApi().market.cancel(item.name)"
          >
            {{ t('settings.marketCancel') }}
          </Button>
        </div>
      </article>
    </div>

    <div v-else class="space-y-3">
      <p v-if="installedCards.length === 0" class="text-[12px] text-[var(--text-tertiary)]">
        {{ t('settings.marketEmpty') }}
      </p>
      <article
        v-for="item in installedCards"
        :key="item.name"
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-3"
      >
        <div class="flex gap-3">
          <img
            v-if="preview(item)"
            :src="preview(item) ?? undefined"
            alt=""
            class="h-16 w-24 rounded object-cover"
            @error="markPreviewBroken(item.name)"
          />
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-[13px] font-medium">{{ item.name }}</h2>
            <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">
              {{ t('settings.marketVersion') }} {{ item.version }}
              <template v-if="item.latest"> · {{ t('settings.marketLatest') }} {{ item.latest }}</template>
              · {{ item.license }}
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <Button
                v-if="item.updateAvailable && item.latest"
                size="sm"
                :disabled="busy === item.name"
                @click="install(item.name, item.latest)"
              >
                {{ t('settings.marketUpdate') }}
              </Button>
              <Button
                v-if="item.kind === 'theme'"
                size="sm"
                variant="secondary"
                @click="applyTheme(item)"
              >
                {{ t('settings.marketApply') }}
              </Button>
              <Button
                v-else-if="MASCOT_ENABLED"
                size="sm"
                variant="secondary"
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
            </div>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
