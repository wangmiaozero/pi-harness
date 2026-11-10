<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import Button from '@renderer/components/ui/Button.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import { Check, PawPrint } from '@lucide/vue'
import type { PetPackSummary } from '@shared/ipc/api-types'

const { t } = useI18n()
const emit = defineEmits<{ ready: [boolean] }>()

const packs = ref<PetPackSummary[]>([])
const loading = ref(false)
const loaded = ref(false)
const importing = ref(false)
const removing = ref(false)

const selectedId = defineModel<string>({ default: 'bigfish' })


const selectedPack = computed(
  () => packs.value.find((pack) => pack.id === selectedId.value) ?? null
)

const canRemove = computed(() => Boolean(selectedPack.value && !selectedPack.value.bundled))

watch([loaded, selectedPack], () => {
  if (!loaded.value) return
  emit('ready', Boolean(selectedPack.value))
})

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const list = (await window.piSwitch?.pets.list()) ?? []
    packs.value = list
  } catch (error) {
    toast.error(t('settings.petPackListFailed'), { description: errorText(error) })
  } finally {
    loading.value = false
    loaded.value = true
  }
}

async function onSelectionChange(id: string): Promise<void> {
  if (id === selectedId.value) return
  const previous = selectedId.value
  selectedId.value = id
  try {
    await window.piSwitch?.pets.setActive(id)
  } catch (error) {
    selectedId.value = previous
    toast.error(t('settings.petPackSwitchFailed'), { description: errorText(error) })
  }
}

async function importPack(kind: 'zip' | 'directory'): Promise<void> {
  importing.value = true
  try {
    const result = await window.piSwitch?.pets.import(kind)
    if (!result) return // dialog cancelled
    toast.success(
      result.updated
        ? t('settings.petPackUpdated', { name: result.name })
        : t('settings.petPackImported', { name: result.name })
    )
    selectedId.value = result.id
    await refresh()
  } catch (error) {
    toast.error(t('settings.petPackImportFailed'), { description: errorText(error) })
  } finally {
    importing.value = false
  }
}

async function removePack(): Promise<void> {
  const id = selectedId.value
  if (!id || !canRemove.value) return
  removing.value = true
  try {
    await window.piSwitch?.pets.remove(id)
    toast.success(t('settings.petPackRemoved'))
    selectedId.value = 'bigfish'
    await refresh()
  } catch (error) {
    toast.error(t('settings.petPackRemoveFailed'), { description: errorText(error) })
  } finally {
    removing.value = false
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="space-y-3" data-testid="pet-pack-manager">
    <div
      v-if="packs.length"
      role="group"
      :aria-label="$t('settings.petPackSelect')"
      class="pet-pack-grid"
      data-testid="pet-pack-grid"
    >
      <button
        v-for="pack in packs"
        :key="pack.id"
        type="button"
        class="relative flex min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border p-2.5 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        :class="
          pack.id === selectedId
            ? 'border-[var(--accent)] bg-[var(--accent-tint-soft)] shadow-[0_0_0_1px_var(--accent)]'
            : 'border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
        "
        :aria-pressed="pack.id === selectedId"
        :data-pet-pack-option="pack.id"
        @click="onSelectionChange(pack.id)"
      >
        <span
          class="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-window)]/60 text-[var(--accent)]"
        >
          <PawPrint class="size-5" :stroke-width="1.5" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[12px] font-medium text-[var(--text-primary)]">
            {{ pack.name }}
          </span>
          <span class="block truncate text-[10.5px] text-[var(--text-tertiary)]">
            {{ [pack.author, pack.version ? `v${pack.version}` : ''].filter(Boolean).join(' · ') }}
          </span>
          <span v-if="pack.bundled || !pack.compatible" class="mt-1 flex flex-wrap gap-1">
            <Badge v-if="pack.bundled" tone="muted">{{ $t('settings.petPackBundledBadge') }}</Badge>
            <Badge v-if="!pack.compatible" tone="warning">
              {{ $t('settings.petPackIncompatible') }}
            </Badge>
          </span>
        </span>
        <Check
          v-if="pack.id === selectedId"
          class="size-4 shrink-0 text-[var(--accent)]"
          :stroke-width="2.25"
        />
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        :loading="importing"
        data-testid="pet-import-zip"
        @click="importPack('zip')"
      >
        {{ $t('settings.petPackImportZip') }}
      </Button>
      <Button
        size="sm"
        :loading="importing"
        data-testid="pet-import-folder"
        @click="importPack('directory')"
      >
        {{ $t('settings.petPackImportFolder') }}
      </Button>
      <Button
        v-if="selectedPack"
        size="sm"
        variant="danger"
        :disabled="!canRemove"
        :loading="removing"
        data-testid="pet-remove-pack"
        @click="removePack"
      >
        {{ $t('settings.petPackRemove') }}
      </Button>
      <span v-if="selectedPack?.bundled" class="text-[11px] text-[var(--text-tertiary)]">
        {{ $t('settings.petPackBundledProtected') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.pet-pack-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
</style>
