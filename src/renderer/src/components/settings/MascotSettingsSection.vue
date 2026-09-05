<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { CircleOff, KeyRound } from '@lucide/vue'
import { DEFAULT_MASCOT_STYLE, MASCOT_STYLES, type MascotStyle } from '@shared/constants/mascot'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { MASCOT_IMAGES } from '@renderer/utils/mascot-images'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'

const draft = inject(SETTINGS_DRAFT_KEY)!

const { t } = useI18n()
const store = useSettingsStore()

const unlocking = ref(false)
const answer = ref('')
const unlockError = ref('')

const mascotOptions = computed(() =>
  MASCOT_STYLES.map((style) => ({
    value: style,
    image: MASCOT_IMAGES[style],
    label: t(`settings.mascot${style[0].toUpperCase()}${style.slice(1)}`),
    description: t(`settings.mascot${style[0].toUpperCase()}${style.slice(1)}Hint`)
  }))
)

const petSleepMinutesStr = computed({
  get: () => String(draft.value.petSleepMinutes),
  set: (v: string) => {
    const n = parseInt(v, 10)
    draft.value.petSleepMinutes = Number.isFinite(n) ? Math.min(120, Math.max(1, n)) : 10
  }
})

function selectMascot(style: MascotStyle): void {
  draft.value.mascotStyle = style
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
      <div class="mascot-options-grid" data-testid="mascot-options-grid">
        <button
          v-for="option in mascotOptions"
          :key="option.value"
          type="button"
          class="mascot-option flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          :class="
            draft.mascotStyle === option.value
              ? 'border-[var(--accent-border)] bg-[var(--accent-tint-soft)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
          "
          :aria-pressed="draft.mascotStyle === option.value"
          :data-mascot-option="option.value"
          @click="selectMascot(option.value)"
        >
          <div class="mascot-option-preview bg-[var(--bg-window)]/45">
            <img
              v-if="option.image"
              :src="option.image"
              alt=""
              loading="lazy"
              class="mascot-option-image"
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
                {{ option.label }}
              </div>
            </div>
            <div class="mt-0.5 line-clamp-2 text-[10.5px] leading-4 text-[var(--text-tertiary)]">
              {{ option.description }}
            </div>
          </div>
        </button>
      </div>
      <div
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
.mascot-options-grid {
  display: grid;
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

@container mascot-gallery (min-width: 1100px) {
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
