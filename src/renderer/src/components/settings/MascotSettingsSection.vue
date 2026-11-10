<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Check, CircleOff, FolderPlus, KeyRound, Upload } from '@lucide/vue'
import { themePackForStyle } from '@shared/market/style-packs'
import { humanizeSlug } from '@renderer/market/display'
import { DEFAULT_MASCOT_STYLE, MASCOT_STYLES, type MascotStyle } from '@shared/constants/mascot'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { MASCOT_IMAGES } from '@renderer/utils/mascot-images'
import {
  installRevision,
  themeAssetsReady,
  themeCardPreview,
  themePackInstalled
} from '@renderer/utils/visual-skin'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const draft = inject(SETTINGS_DRAFT_KEY)!

const { t } = useI18n()
const store = useSettingsStore()

const unlocking = ref(false)
const answer = ref('')
const unlockError = ref('')
const importingSkin = ref(false)
const creatingSkinProject = ref(false)

const failedPreviews = ref<Record<string, boolean>>({})

watch(installRevision, () => {
  failedPreviews.value = {}
})

const mascotOptions = computed(() => {
  void installRevision.value
  return MASCOT_STYLES.map((style) => {
    const image = MASCOT_IMAGES[style]
    return {
      value: style,
      image,
      preview: themeCardPreview(style, image, Boolean(failedPreviews.value[style])),
      label: t(`settings.mascot${style[0].toUpperCase()}${style.slice(1)}`),
      description: t(`settings.mascot${style[0].toUpperCase()}${style.slice(1)}Hint`)
    }
  })
})

const visibleMascotOptions = computed(() =>
  mascotOptions.value.filter((option) => option.preview !== 'missing')
)

type MascotOption = (typeof mascotOptions.value)[number]

interface MascotCard {
  key: string
  title: string
  variants: MascotOption[]
  current: MascotOption
}

const mascotCards = computed<MascotCard[]>(() => {
  const cards: MascotCard[] = []
  const byPack = new Map<string, MascotCard>()
  for (const option of visibleMascotOptions.value) {
    const packId = themePackForStyle(option.value)
    const existing = packId ? byPack.get(packId) : undefined
    if (existing) {
      existing.variants.push(option)
      continue
    }
    const card: MascotCard = {
      key: packId ?? option.value,
      title: packId ? humanizeSlug(packId) : option.label,
      variants: [option],
      current: option
    }
    if (packId) byPack.set(packId, card)
    cards.push(card)
  }
  for (const card of cards) {
    card.current =
      card.variants.find((variant) => variant.value === draft.value.mascotStyle) ?? card.variants[0]
  }
  return cards
})

const themeControlsVisible = computed(() => {
  void installRevision.value
  return draft.value.mascotStyle !== 'none' && themePackInstalled(draft.value.mascotStyle)
})

const themePackMissing = computed(() => {
  void installRevision.value
  if (!themeAssetsReady()) return false
  const hasInstalledTheme = visibleMascotOptions.value.some((option) => option.value !== 'none')
  if (!hasInstalledTheme) return true
  return draft.value.mascotStyle !== 'none' && !themePackInstalled(draft.value.mascotStyle)
})

const petSleepMinutesStr = computed({
  get: () => String(draft.value.petSleepMinutes),
  set: (v: string) => {
    const n = parseInt(v, 10)
    draft.value.petSleepMinutes = Number.isFinite(n) ? Math.min(120, Math.max(1, n)) : 10
  }
})

function cardSelected(card: MascotCard): boolean {
  return !draft.value.customSkinId && card.variants.some((v) => v.value === draft.value.mascotStyle)
}

/** Variant labels usually repeat the pack name ("DeepSeek Pro"); the chip only needs the rest. */
function variantLabel(card: MascotCard, variant: MascotOption): string {
  const rest = variant.label.startsWith(card.title)
    ? variant.label.slice(card.title.length).trim()
    : variant.label
  return rest || variant.label
}

function selectMascot(style: MascotStyle): void {  draft.value.mascotStyle = style
  draft.value.customSkinId = null
}

function selectCustomSkin(id: string): void {
  draft.value.mascotStyle = DEFAULT_MASCOT_STYLE
  draft.value.customSkinId = id
}

async function importCustomSkin(): Promise<void> {
  if (importingSkin.value) return
  importingSkin.value = true
  try {
    const imported = await store.importCustomSkin()
    if (!imported) return
    selectCustomSkin(imported.id)
    toast.success(t('settings.customSkinImported', { name: imported.name }))
  } catch (error) {
    toast.error(
      (error as { userMessage?: string; message?: string }).userMessage ?? (error as Error).message
    )
  } finally {
    importingSkin.value = false
  }
}

async function createCustomSkinProject(): Promise<void> {
  if (creatingSkinProject.value) return
  creatingSkinProject.value = true
  try {
    const project = await store.createCustomSkinProject()
    if (project) toast.success(t('settings.customSkinProjectCreated'))
  } catch (error) {
    toast.error(
      (error as { userMessage?: string; message?: string }).userMessage ?? (error as Error).message
    )
  } finally {
    creatingSkinProject.value = false
  }
}

async function unlockMascot(): Promise<void> {
  if (unlocking.value) return
  unlocking.value = true
  unlockError.value = ''
  try {
    const unlocked = await store.unlockMascot(answer.value)
    if (!unlocked) {
      unlockError.value = t('settings.mascotUnlockIncorrect')
      return
    }
    draft.value.mascotUnlocked = true
    draft.value.mascotStyle = DEFAULT_MASCOT_STYLE
    answer.value = ''
    unlockError.value = ''
    toast.success(t('settings.mascotUnlockSuccess'))
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('common.failed'))
  } finally {
    unlocking.value = false
  }
}
</script>

<template>
  <section
    data-testid="mascot-settings-section"
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <div v-if="!draft.mascotUnlocked" id="mascot-settings-content" class="p-3">
      <form
        data-testid="mascot-unlock-form"
        class="rounded-[var(--radius-sm)] border border-[var(--warning)]/30 bg-[var(--warning-tint)] p-3"
        @submit.prevent="unlockMascot"
      >
        <div class="flex items-start gap-2.5">
          <KeyRound class="mt-0.5 size-4 shrink-0 text-[var(--warning)]" :stroke-width="1.75" />
          <div class="min-w-0 flex-1">
            <label
              for="mascot-unlock-answer"
              class="block text-[12px] font-semibold text-[var(--text-primary)]"
            >
              {{ $t('settings.mascotUnlockQuestion') }}
            </label>
            <p class="mt-0.5 text-[10.5px] text-[var(--text-tertiary)]">
              {{ $t('settings.mascotLockedHint') }}
            </p>
            <div class="mt-2 flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <input
                  id="mascot-unlock-answer"
                  v-model="answer"
                  data-testid="mascot-unlock-answer"
                  type="password"
                  inputmode="numeric"
                  autocomplete="off"
                  :placeholder="$t('settings.mascotUnlockPlaceholder')"
                  class="h-[var(--height-input)] w-full rounded-[var(--radius-sm)] border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 font-[family-name:var(--font-mono)] text-[12px] text-[var(--text-primary)] shadow-[var(--control-shadow)] placeholder:text-[var(--control-placeholder)] hover:border-[var(--control-border-hover)] focus:border-[var(--accent)] focus:outline-none focus:shadow-[var(--focus-ring)]"
                  :aria-invalid="Boolean(unlockError)"
                  :aria-describedby="unlockError ? 'mascot-unlock-error' : undefined"
                  @input="unlockError = ''"
                />
                <p
                  v-if="unlockError"
                  id="mascot-unlock-error"
                  role="alert"
                  class="mt-1 text-[10.5px] text-[var(--error)]"
                >
                  {{ unlockError }}
                </p>
              </div>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                :loading="unlocking"
                :disabled="!answer.trim() || unlocking"
              >
                {{ $t('settings.mascotUnlockAction') }}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>

    <div v-else id="mascot-settings-content" class="p-3">
      <p class="mb-3 text-[11.5px] text-[var(--text-tertiary)]">
        {{ $t('settings.mascotHint') }}
      </p>
      <p
        v-if="themePackMissing"
        data-testid="mascot-missing-theme"
        class="mb-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2 text-[12px] text-[var(--text-secondary)]"
      >
        {{ $t('settings.marketMissingTheme') }}
        <RouterLink class="ml-1 underline" to="/settings/market">{{ $t('settings.marketOpen') }}</RouterLink>
      </p>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          :loading="importingSkin"
          :disabled="importingSkin"
          data-testid="custom-skin-import"
          @click="importCustomSkin"
        >
          <Upload class="size-3.5" :stroke-width="1.75" />
          {{ $t('settings.customSkinImport') }}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          :loading="creatingSkinProject"
          :disabled="creatingSkinProject"
          data-testid="custom-skin-create-project"
          @click="createCustomSkinProject"
        >
          <FolderPlus class="size-3.5" :stroke-width="1.75" />
          {{ $t('settings.customSkinCreateProject') }}
        </Button>
        <span class="text-[10.5px] text-[var(--text-tertiary)]">
          {{ $t('settings.customSkinHint') }}
        </span>
      </div>
      <h3 class="mascot-group-title">{{ $t('settings.mascotGalleryThemes') }}</h3>
      <div class="mascot-options-grid" data-testid="mascot-options-grid">
        <div
          v-for="card in mascotCards"
          :key="card.key"
          class="mascot-card relative min-w-0"
          :data-mascot-pack="card.key"
        >
          <button
            type="button"
            class="mascot-option flex w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            :class="
              cardSelected(card)
                ? 'mascot-option-selected border-[var(--accent)] bg-[var(--accent-tint-soft)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
            "
            :aria-pressed="cardSelected(card)"
            :data-mascot-option="card.current.value"
            @click="selectMascot(card.current.value)"
          >
            <div class="mascot-option-preview bg-[var(--bg-window)]/45">
              <img
                v-if="card.current.preview === 'image'"
                :key="`${card.current.value}:${installRevision}`"
                :src="card.current.image || undefined"
                alt=""
                loading="lazy"
                class="mascot-option-image"
                @error="failedPreviews[card.current.value] = true"
              />
              <div
                v-else
                class="flex size-full items-center justify-center text-[var(--text-tertiary)]"
              >
                <CircleOff class="size-10" :stroke-width="1.25" />
              </div>
            </div>
            <div class="mascot-option-copy border-t border-[var(--border-subtle)] p-3">
              <div class="flex min-w-0 items-center gap-1.5">
                <div class="truncate text-[12px] font-medium text-[var(--text-primary)]">
                  {{ card.variants.length > 1 ? card.title : card.current.label }}
                </div>
              </div>
              <div class="mt-0.5 line-clamp-2 text-[10.5px] leading-4 text-[var(--text-tertiary)]">
                {{
                  card.variants.length > 1
                    ? `${card.current.label} · ${card.current.description}`
                    : card.current.description
                }}
              </div>
            </div>
          </button>
          <span
            v-if="cardSelected(card)"
            class="mascot-option-check"
            data-testid="mascot-selected-badge"
            :title="$t('settings.mascotSelectedBadge')"
          >
            <Check class="size-3" :stroke-width="2.5" />
          </span>
          <div
            v-if="card.variants.length > 1"
            role="group"
            class="mascot-variant-bar"
            :aria-label="`${card.title} · ${$t('settings.mascotVariants')}`"
            data-testid="mascot-variant-switcher"
          >
            <button
              v-for="variant in card.variants"
              :key="variant.value"
              type="button"
              class="mascot-variant-chip"
              :class="{ 'mascot-variant-chip-active': draft.mascotStyle === variant.value }"
              :aria-pressed="draft.mascotStyle === variant.value"
              :title="variant.label"
              :data-mascot-variant="variant.value"
              @click="selectMascot(variant.value)"
            >
              {{ variantLabel(card, variant) }}
            </button>
          </div>
        </div>
      </div>
      <template v-if="store.customSkins.length">
        <h3 class="mascot-group-title mt-4">{{ $t('settings.mascotGalleryCustom') }}</h3>
        <div class="mascot-options-grid" data-testid="mascot-custom-skins-grid">
          <div v-for="skin in store.customSkins" :key="`custom-${skin.id}`" class="relative min-w-0">
            <button
              type="button"
              class="mascot-option flex w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              :class="
                draft.customSkinId === skin.id
                  ? 'mascot-option-selected border-[var(--accent)] bg-[var(--accent-tint-soft)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
              "
              :aria-pressed="draft.customSkinId === skin.id"
              :data-custom-skin-option="skin.id"
              @click="selectCustomSkin(skin.id)"
            >
              <div class="mascot-option-preview bg-[var(--bg-window)]/45">
                <img
                  v-if="skin.previewDataUrl || skin.wallpaperDataUrl || skin.portraitDataUrl"
                  :src="skin.previewDataUrl || skin.wallpaperDataUrl || skin.portraitDataUrl || ''"
                  alt=""
                  loading="lazy"
                  class="mascot-option-image"
                />
                <div
                  v-else
                  class="custom-skin-swatch size-full"
                  :style="{ background: skin.tokens.workspace }"
                />
              </div>
              <div class="mascot-option-copy border-t border-[var(--border-subtle)] p-3">
                <div class="flex min-w-0 items-center justify-between gap-2">
                  <div class="truncate text-[12px] font-medium text-[var(--text-primary)]">
                    {{ skin.name }}
                  </div>
                  <span class="shrink-0 text-[9.5px] text-[var(--accent)]">{{
                    $t('settings.customSkinBadge')
                  }}</span>
                </div>
                <div class="mt-0.5 line-clamp-2 text-[10.5px] leading-4 text-[var(--text-tertiary)]">
                  {{
                    skin.description ||
                    `${skin.author || $t('settings.customSkinUnknownAuthor')} · v${skin.version}`
                  }}
                </div>
              </div>
            </button>
            <span
              v-if="draft.customSkinId === skin.id"
              class="mascot-option-check"
              :title="$t('settings.mascotSelectedBadge')"
            >
              <Check class="size-3" :stroke-width="2.5" />
            </span>
          </div>
        </div>
      </template>      <div
        v-if="themeControlsVisible"
        data-testid="mascot-theme-controls"
        class="mt-3 divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
      >
        <PropertyRow :label="$t('settings.petAnimations')">
          <Switch v-model="draft.petAnimations" :label="$t('settings.petAnimations')" />
        </PropertyRow>
        <PropertyRow :label="$t('settings.petStatusText')">
          <Switch v-model="draft.petStatusText" :label="$t('settings.petStatusText')" />
        </PropertyRow>
        <PropertyRow :label="$t('settings.petAutoSleep')">
          <Switch v-model="draft.petAutoSleep" :label="$t('settings.petAutoSleep')" />
        </PropertyRow>
        <PropertyRow :label="$t('settings.petSleepMinutes')">
          <Input
            v-model="petSleepMinutesStr"
            type="number"
            min="1"
            max="120"
            class="w-20"
            :disabled="!draft.petAutoSleep"
          />
        </PropertyRow>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mascot-group-title {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
}

.mascot-option-selected {
  box-shadow: 0 0 0 1px var(--accent);
}

.mascot-option-check {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--accent);
  color: var(--text-on-accent, #fff);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
  pointer-events: none;
}

/* Sits over the bottom of the 208px preview so card heights stay uniform. */
.mascot-variant-bar {
  position: absolute;
  top: 172px;
  left: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.mascot-variant-chip {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 50%;
  height: 26px;
  overflow: hidden;
  padding: 0 9px;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 999px;
  background: rgb(10 14 24 / 0.62);
  color: rgb(255 255 255 / 0.86);
  font-size: 10.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  backdrop-filter: blur(8px);
  transition:
    background-color var(--motion-fast, 120ms),
    border-color var(--motion-fast, 120ms);
}

.mascot-variant-chip:hover {
  background: rgb(10 14 24 / 0.78);
}

.mascot-variant-chip:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.mascot-variant-chip-active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--text-on-accent, #fff);
}

.mascot-variant-chip-active:hover {
  background: var(--accent);
}

.mascot-options-grid {  display: grid;
  grid-template-columns: repeat(var(--mascot-columns, 1), minmax(0, 1fr));
  gap: 14px;
}

.mascot-option-preview {
  height: 208px;
  flex: none;
  overflow: hidden;
}

/* Crop only the picker viewport; the original art and workspace portrait stay intact. */
.mascot-option-image {
  display: block;
  width: 100%;
  max-width: 320px;
  height: 100%;
  margin-inline: auto;
  object-fit: cover;
  object-position: center top;
}

.mascot-option-copy {
  height: 80px;
  flex: none;
}

.settings-mascot-gallery {
  container: mascot-gallery / inline-size;
}

@container mascot-gallery (min-width: 500px) {
  .mascot-options-grid {
    --mascot-columns: 2;
  }
}

@container mascot-gallery (min-width: 800px) {
  .mascot-options-grid {
    --mascot-columns: 3;
  }
}

@container mascot-gallery (min-width: 1040px) {
  .mascot-options-grid {
    --mascot-columns: 4;
  }
}

@container mascot-gallery (min-width: 1400px) {
  .mascot-options-grid {
    --mascot-columns: 5;
  }
}
</style>
