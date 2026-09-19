<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronRight, Search } from '@lucide/vue'
import ThinkingSlider from './ThinkingSlider.vue'
import { composerThinkingLevels } from './thinking-levels'

interface ModelOption {
  value: string
  label: string
  group?: string
}

interface VendorGroup {
  label: string
  options: ModelOption[]
}

const modelValue = defineModel<string>('model', { required: true })
const thinkingValue = defineModel<string>('thinking', { required: true })
const emit = defineEmits<{ interact: [] }>()
const props = withDefaults(
  defineProps<{
    options: ModelOption[]
    thinkingLevels?: string[]
    disabled?: boolean
  }>(),
  { thinkingLevels: () => composerThinkingLevels(), disabled: false }
)

const open = ref(false)
const search = ref('')
const trigger = ref<HTMLButtonElement | null>(null)
const vendorPanel = ref<HTMLElement | null>(null)
const modelPanel = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const vendorStyle = ref<Record<string, string>>({})
const modelStyle = ref<Record<string, string>>({})
const openVendor = ref<string | null>(null)

const selected = computed(() => props.options.find((option) => option.value === modelValue.value))
const vendors = computed<VendorGroup[]>(() => {
  const groups = new Map<string, VendorGroup>()
  for (const option of props.options) {
    const label = option.group || option.value.split('/')[0] || option.label
    const group = groups.get(label)
    if (group) group.options.push(option)
    else groups.set(label, { label, options: [option] })
  }
  return [...groups.values()]
})
const activeVendor = computed(
  () => vendors.value.find((vendor) => vendor.label === openVendor.value) ?? null
)
const filteredModels = computed(() => {
  const query = search.value.trim().toLowerCase()
  const rows = activeVendor.value?.options ?? []
  if (!query) return rows
  return rows.filter(
    (option) =>
      option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query)
  )
})
const selectedLabel = computed(() => {
  const thinking = thinkingValue.value
  if (!selected.value) return thinking
  const base = selected.value.group
    ? `${selected.value.group} / ${selected.value.label}`
    : selected.value.label
  return `${base} · ${thinking}`
})

function selectedVendor(): string | null {
  return selected.value?.group ?? vendors.value[0]?.label ?? null
}

function vendorHasSelected(vendor: VendorGroup): boolean {
  return vendor.options.some((option) => option.value === modelValue.value)
}

function syncVendorPanel() {
  const el = trigger.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const width = Math.max(rect.width, 200)
  const gap = 10
  const edge = 16
  const estimatedHeight = Math.min(vendors.value.length * 36 + 16, 320)
  const openUp = rect.top >= estimatedHeight + gap + edge
  vendorStyle.value = {
    width: `${Math.round(width)}px`,
    left: `${Math.round(Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge)))}px`,
    top: openUp ? `${Math.round(rect.top - gap)}px` : `${Math.round(rect.bottom + gap)}px`,
    transform: openUp ? 'translateY(-100%)' : 'none'
  }
}

function syncModelPanel() {
  const panel = vendorPanel.value
  if (!panel) return
  const rect = panel.getBoundingClientRect()
  const width = 320
  const gap = 8
  const edge = 16
  const spaceRight = window.innerWidth - rect.right - edge
  const openLeft = spaceRight < width && rect.left - edge > spaceRight
  const left = openLeft ? rect.left - width - gap : rect.right + gap
  const height = Math.min(420, window.innerHeight - edge * 2)
  const top = Math.min(Math.max(edge, rect.bottom - height), window.innerHeight - height - edge)
  modelStyle.value = {
    width: `${width}px`,
    left: `${Math.round(Math.max(edge, Math.min(left, window.innerWidth - width - edge)))}px`,
    top: `${Math.round(top)}px`
  }
}

function syncFloating() {
  syncVendorPanel()
  if (openVendor.value) void nextTick(syncModelPanel)
}

function revealVendor(label: string) {
  openVendor.value = label
  void nextTick(() => {
    syncModelPanel()
    searchInput.value?.focus()
  })
}

function show() {
  if (props.disabled || !props.options.length) return
  emit('interact')
  openVendor.value = selectedVendor()
  search.value = ''
  syncVendorPanel()
  open.value = true
  void nextTick(() => {
    syncModelPanel()
    searchInput.value?.focus()
  })
}

function close() {
  open.value = false
  openVendor.value = null
  search.value = ''
}

function toggle() {
  if (open.value) close()
  else show()
}

function pick(option: ModelOption) {
  emit('interact')
  modelValue.value = option.value
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (
    trigger.value?.contains(target) ||
    vendorPanel.value?.contains(target) ||
    modelPanel.value?.contains(target)
  ) {
    return
  }
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  close()
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', syncFloating)
  window.addEventListener('scroll', syncFloating, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', syncFloating)
  window.removeEventListener('scroll', syncFloating, true)
})

watch(open, (value) => {
  if (value) syncFloating()
})
</script>

<template>
  <div data-testid="workspace-model-select" class="min-w-[190px] max-w-[300px]">
    <button
      ref="trigger"
      type="button"
      class="ui-select-trigger inline-flex h-[var(--height-select)] w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 text-left text-[13px] text-[var(--text-primary)] shadow-[var(--control-shadow)] transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--control-bg-hover)] focus:outline-none focus:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-45"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-label="$t('workspace.model')"
      @click="toggle"
    >
      <span class="min-w-0 flex-1 truncate">{{ selectedLabel }}</span>
      <ChevronDown
        aria-hidden="true"
        class="size-3 shrink-0 text-[var(--text-tertiary)]"
        :stroke-width="1.75"
      />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="vendorPanel"
        data-testid="composer-vendor-panel"
        class="composer-model-picker ui-select-menu pointer-events-auto fixed z-[120] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-popover)]"
        :style="vendorStyle"
        @pointerdown.stop
      >
        <button
          v-for="vendor in vendors"
          :key="vendor.label"
          type="button"
          class="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px] text-[var(--text-primary)] outline-none"
          :class="openVendor === vendor.label ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'"
          :data-select-cascade-group="vendor.label"
          :data-vendor="vendor.label"
          @pointerenter="revealVendor(vendor.label)"
          @mousedown.prevent="revealVendor(vendor.label)"
        >
          <span class="min-w-0 flex-1 truncate">{{ vendor.label }}</span>
          <span
            v-if="vendorHasSelected(vendor)"
            aria-hidden="true"
            class="size-1.5 shrink-0 rounded-full bg-[var(--success)]"
          />
          <ChevronRight
            aria-hidden="true"
            class="size-3.5 shrink-0 text-[var(--text-tertiary)]"
            :stroke-width="1.75"
          />
        </button>
      </div>

      <div
        v-if="open && activeVendor"
        ref="modelPanel"
        data-testid="composer-model-panel"
        data-select-cascade-submenu
        class="composer-model-picker ui-select-menu pointer-events-auto fixed z-[121] flex w-80 flex-col gap-1.5 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-popover)]"
        :style="modelStyle"
        @pointerdown.stop
      >
        <div class="flex items-center justify-between px-2 py-1.5">
          <span class="truncate text-[13px] text-[var(--text-secondary)]">
            {{ activeVendor.label }}
          </span>
        </div>
        <div class="relative mx-1 -mt-0.5 pb-1">
          <Search
            aria-hidden="true"
            class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]"
            :stroke-width="1.8"
          />
          <input
            ref="searchInput"
            v-model="search"
            type="search"
            data-testid="composer-model-search"
            class="h-8 w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--control-bg)] pr-2 pl-7 text-[12.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus-visible:shadow-[var(--focus-ring)]"
            :placeholder="$t('workspace.modelSearchPlaceholder')"
            :aria-label="$t('workspace.modelSearchPlaceholder')"
          />
        </div>
        <div class="flex max-h-[240px] flex-col overflow-y-auto" role="listbox">
          <button
            v-for="option in filteredModels"
            :key="option.value"
            type="button"
            role="option"
            class="ui-select-option flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px] outline-none"
            :class="
              option.value === modelValue
                ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            "
            :aria-selected="option.value === modelValue"
            @mousedown.prevent="pick(option)"
          >
            <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
            <Check
              v-if="option.value === modelValue"
              aria-hidden="true"
              class="size-3.5 shrink-0 text-[var(--text-primary)]"
              :stroke-width="2.2"
            />
          </button>
          <p
            v-if="!filteredModels.length"
            class="px-2 py-2 text-[13px] text-[var(--text-tertiary)]"
          >
            {{ $t('workspace.noMatchingModels') }}
          </p>
        </div>
        <div class="-mx-1 mt-1 h-px bg-[var(--border-default)]" />
        <div class="relative z-10 flex flex-col px-1 pb-1">
          <span class="relative z-10 px-1 text-[13px] font-medium text-[var(--text-primary)]">
            {{ $t('workspace.thinkingIntensity') }}
            <span class="font-normal">{{ thinkingValue }}</span>
          </span>
          <div class="relative z-10 flex items-center justify-between px-1 pt-2 pb-1 text-[11.5px] text-[var(--text-secondary)]">
            <span>{{ $t('workspace.thinkingFaster') }}</span>
            <span>{{ $t('workspace.thinkingDeeper') }}</span>
          </div>
          <div class="px-1 pb-1">
            <ThinkingSlider v-model="thinkingValue" :levels="thinkingLevels" />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
