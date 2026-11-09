<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import { getApi } from '@renderer/composables/useApi'
import { reloadInstalledCatalog } from '@renderer/market/catalog'
import { useSettingsStore } from '@renderer/stores/settings'
import { applyVisualSkin } from '@renderer/utils/visual-skin'
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

function bytes(value: number | null): string {
  if (!value || value < 0) return '—'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function load(refresh = false): Promise<void> {
  error.value = ''
  try {
    if (tab.value === 'installed' || refresh) {
      installed.value = refresh
        ? await getApi().market.refresh()
        : await getApi().market.installed()
    }
    if (tab.value !== 'installed') {
      searchResult.value = await getApi().market.search(query.value, tab.value, refresh)
    }
  } catch (reason) {
    error.value = message(reason)
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
    toast.success(name)
    await load(false)
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

function preview(item: InstalledMarketPackage): string {
  return marketFileUrl(item.kind, item.packId, 'preview.webp')
}

function selectTab(next: 'theme' | 'pet' | 'installed'): void {
  tab.value = next
  void load(false)
}

let stopProgress: (() => void) | undefined

onMounted(() => {
  stopProgress = getApi().on('market-progress', (payload) => {
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

    <div v-if="tab !== 'installed'" class="space-y-3">
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
            :src="preview(item)"
            alt=""
            class="h-16 w-24 rounded object-cover"
            loading="lazy"
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
