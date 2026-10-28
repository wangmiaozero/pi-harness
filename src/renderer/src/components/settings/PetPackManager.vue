<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import Button from '@renderer/components/ui/Button.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import Select from '@renderer/components/ui/Select.vue'
import type { PetPackDetail, PetPackSummary } from '@shared/ipc/api-types'

const { t } = useI18n()

const packs = ref<PetPackSummary[]>([])
const detail = ref<PetPackDetail | null>(null)
const loading = ref(false)
const importing = ref(false)
const removing = ref(false)

const selectedId = defineModel<string>({ default: 'bigfish' })

const packOptions = computed(() =>
  packs.value.map((pack) => ({
    value: pack.id,
    label:
      (pack.bundled ? `★ ${pack.name}` : pack.name) +
      (pack.compatible ? '' : ` — ${t('settings.petPackIncompatible')}`)
  }))
)

const selectedPack = computed(() => packs.value.find((pack) => pack.id === selectedId.value) ?? null)

const previewUrl = computed(() => {
  const preview = detail.value?.preview
  if (!preview || !detail.value?.compatible) return null
  return `pi-pet://petpack/${detail.value.id}/${preview}`
})

const canRemove = computed(() => Boolean(selectedPack.value && !selectedPack.value.bundled))

function describePack(pack: PetPackSummary): string {
  return [pack.nameEn, `v${pack.version}`, pack.author, `${t('settings.petPackClips')}: ${pack.clipCount}`]
    .filter(Boolean)
    .join(' · ')
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const list = (await window.piSwitch?.pets.list()) ?? []
    packs.value = list
    if (!list.some((pack) => pack.id === selectedId.value)) {
      selectedId.value = list[0]?.id ?? 'bigfish'
    }
    detail.value = (await window.piSwitch?.pets.detail(selectedId.value)) ?? null
  } catch (error) {
    toast.error(t('settings.petPackListFailed'), { description: errorText(error) })
  } finally {
    loading.value = false
  }
}

async function onSelectionChange(id: string): Promise<void> {
  if (id === selectedId.value) return
  const previous = selectedId.value
  selectedId.value = id
  try {
    detail.value = (await window.piSwitch?.pets.setActive(id)) ?? null
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
    detail.value = (await window.piSwitch?.pets.detail(result.id)) ?? null
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
    <PropertyRow :label="$t('settings.petPackActive')">
      <Select
        :model-value="selectedId"
        :options="packOptions"
        :aria-label="$t('settings.petPackActive')"
        layout="row"
        class="w-56"
        @update:model-value="onSelectionChange"
      />
    </PropertyRow>

    <div
      v-if="detail"
      class="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-3"
      data-testid="pet-pack-info"
    >
      <img
        v-if="previewUrl"
        :src="previewUrl"
        :alt="$t('settings.petPackPreviewAlt')"
        class="h-16 w-16 shrink-0 rounded object-contain"
      />
      <div class="min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        <p class="truncate font-medium text-[var(--text-primary)]">{{ detail.name }}</p>
        <p class="truncate">{{ describePack(detail) }}</p>
        <p v-if="detail.description" class="mt-1 line-clamp-2">{{ detail.description }}</p>
        <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">
          {{ $t('settings.petPackLicense') }}: {{ detail.license }}
        </p>
        <p v-if="!detail.compatible" class="mt-1 text-[var(--text-danger)]">
          {{ detail.resourceError ?? $t('settings.petPackIncompatible') }}
        </p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" :loading="importing" data-testid="pet-import-zip" @click="importPack('zip')">
        {{ $t('settings.petPackImportZip') }}
      </Button>
      <Button size="sm" :loading="importing" data-testid="pet-import-folder" @click="importPack('directory')">
        {{ $t('settings.petPackImportFolder') }}
      </Button>
      <Button
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
