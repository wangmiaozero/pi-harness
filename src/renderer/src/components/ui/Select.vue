<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Check, ChevronDown, ChevronRight } from '@lucide/vue'

const model = defineModel<string>({ default: '' })

interface SelectOption {
  value: string
  label: string
  group?: string
  disabled?: boolean
}

interface OptionGroup {
  label: string | null
  options: SelectOption[]
}

const props = withDefaults(
  defineProps<{
    label?: string
    disabled?: boolean
    options: SelectOption[]
    hint?: string
    error?: string
    layout?: 'stacked' | 'row'
    placeholder?: string
    ariaLabel?: string
    mono?: boolean
    size?: 'md' | 'sm'
    tone?: 'default' | 'success' | 'warning' | 'error'
    menuMinWidth?: number
    cascade?: boolean
  }>(),
  {
    label: '',
    hint: '',
    error: '',
    disabled: false,
    layout: 'stacked',
    placeholder: '',
    ariaLabel: '',
    size: 'md',
    tone: 'default',
    menuMinWidth: 0,
    cascade: false
  }
)

const selectId = useId()
const listboxId = `${selectId}-listbox`
const menuId = `${selectId}-menu`
const open = ref(false)
const activeIndex = ref(-1)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const submenuRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
const submenuStyle = ref<Record<string, string>>({})
const listMaxHeight = ref(240)
const submenuMaxHeight = ref(240)
const openGroupKey = ref<string | null>(null)
const cascadeFocus = ref<'group' | 'option'>('group')

const selected = computed(() => props.options.find((o) => o.value === model.value))
const selectedLabel = computed(() => {
  if (!selected.value) return ''
  return selected.value.group
    ? `${selected.value.group} / ${selected.value.label}`
    : selected.value.label
})

const optionGroups = computed<OptionGroup[]>(() => {
  const groups = new Map<string, OptionGroup>()
  for (const option of props.options) {
    const key = option.group ?? ''
    const group = groups.get(key)
    if (group) group.options.push(option)
    else groups.set(key, { label: option.group ?? null, options: [option] })
  }
  return [...groups.values()]
})

const cascadeGroups = computed(() => optionGroups.value.filter((group) => group.label))
const ungroupedOptions = computed(() =>
  optionGroups.value.filter((group) => !group.label).flatMap((group) => group.options)
)
const usesCascade = computed(() => props.cascade && cascadeGroups.value.length > 0)
const openGroup = computed(
  () => cascadeGroups.value.find((group) => group.label === openGroupKey.value) ?? null
)

const fieldClasses = computed(() =>
  props.layout === 'row'
    ? 'grid grid-cols-[132px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-3 py-2'
    : 'flex flex-col gap-1'
)

const triggerClasses = computed(() => {
  const base =
    'ui-select-trigger inline-flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--control-border)] ' +
    'bg-[var(--control-bg)] text-left text-[var(--text-primary)] shadow-[var(--control-shadow)] ' +
    'transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
    'hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] ' +
    'focus:border-[var(--accent)] focus:bg-[var(--control-bg-hover)] focus:outline-none focus:shadow-[var(--focus-ring)] ' +
    'disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:bg-[var(--control-bg-disabled)] disabled:text-[var(--text-disabled)] disabled:shadow-none'
  const size = props.size === 'sm' ? 'h-7 px-2' : 'h-[var(--height-select)] px-2.5'
  const text = props.mono
    ? 'text-[12px] font-[family-name:var(--font-mono)]'
    : props.size === 'sm'
      ? 'text-[11.5px]'
      : 'text-[13px]'
  const tone = {
    default: '',
    success: '!text-[var(--success)]',
    warning: '!text-[var(--warning)]',
    error: '!text-[var(--error)]'
  }[props.tone]
  return `${base} ${size} ${text} ${tone}`
})

const activeDescendant = computed(() => {
  if (!open.value) return undefined
  if (usesCascade.value && cascadeFocus.value === 'group' && openGroupKey.value) {
    const index = cascadeGroups.value.findIndex((group) => group.label === openGroupKey.value)
    return index >= 0 ? vendorId(index) : undefined
  }
  return activeIndex.value >= 0 ? optionId(activeIndex.value) : undefined
})

function vendorId(index: number): string {
  return `${selectId}-vendor-${index}`
}

function optionId(index: number): string {
  return `${selectId}-option-${index}`
}

function optionIndex(option: SelectOption): number {
  return props.options.indexOf(option)
}

function groupHasSelected(group: OptionGroup): boolean {
  return group.options.some((option) => option.value === model.value)
}

function selectedGroupKey(): string | null {
  return selected.value?.group ?? cascadeGroups.value[0]?.label ?? null
}

function firstEnabledIndex(list = props.options): number {
  return list.findIndex((option) => !option.disabled)
}

function lastEnabledIndex(list = props.options): number {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (!list[index]?.disabled) return index
  }
  return -1
}

function selectedEnabledIndex(): number {
  const index = props.options.findIndex((option) => option.value === model.value)
  return index >= 0 && !props.options[index]?.disabled ? index : firstEnabledIndex()
}

function firstEnabledInGroup(group: OptionGroup | null): number {
  if (!group) return -1
  const option = group.options.find((item) => !item.disabled)
  return option ? optionIndex(option) : -1
}

function selectedOrFirstInGroup(group: OptionGroup | null): number {
  if (!group) return -1
  const selectedOption = group.options.find(
    (option) => option.value === model.value && !option.disabled
  )
  if (selectedOption) return optionIndex(selectedOption)
  return firstEnabledInGroup(group)
}

function syncPanel() {
  const el = triggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const maxH = 240
  const cascade = usesCascade.value
  const gap = cascade ? 10 : 4
  const edge = cascade ? 20 : 8
  const spaceBelow = window.innerHeight - r.bottom - edge
  const openUp = cascade
    ? r.top > Math.min(spaceBelow, window.innerHeight * 0.35)
    : spaceBelow < 180 && r.top > spaceBelow
  const availableHeight = openUp ? r.top - gap - edge : spaceBelow
  const minWidth = cascade ? Math.max(props.menuMinWidth, 168) : props.menuMinWidth
  const width = Math.max(r.width, minWidth)
  listMaxHeight.value = Math.max(80, Math.min(maxH, availableHeight))
  panelStyle.value = {
    top: openUp ? `${Math.round(r.top - gap)}px` : `${Math.round(r.bottom + gap)}px`,
    left: `${Math.round(Math.max(edge, Math.min(r.left, window.innerWidth - width - edge)))}px`,
    width: `${Math.round(width)}px`,
    transform: openUp ? 'translateY(-100%)' : 'none'
  }
}

function syncSubmenu() {
  const panel = panelRef.value
  const group = openGroup.value
  if (!panel || !group?.label) return
  const panelRect = panel.getBoundingClientRect()
  const width = Math.max(panelRect.width, 168)
  const gap = 4
  const edge = 20
  const spaceRight = window.innerWidth - panelRect.right - edge
  const spaceLeft = panelRect.left - edge
  const openLeft = spaceRight < width && spaceLeft > spaceRight
  const rawLeft = openLeft ? panelRect.left - width - gap : panelRect.right + gap
  const estimated = Math.min(240, group.options.length * 32 + 16)
  const maxBottom = Math.min(window.innerHeight - edge, panelRect.bottom)
  let top = panelRect.top
  if (top + estimated > maxBottom) {
    top = Math.max(edge, maxBottom - estimated)
  }
  submenuMaxHeight.value = Math.max(80, Math.min(240, window.innerHeight - top - edge))
  submenuStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(Math.max(edge, Math.min(rawLeft, window.innerWidth - width - edge)))}px`,
    width: `${Math.round(width)}px`
  }
}

function syncFloating() {
  syncPanel()
  if (usesCascade.value && openGroupKey.value) syncSubmenu()
}

function scrollActiveIntoView(): void {
  void nextTick(() => {
    const root = cascadeFocus.value === 'option' ? submenuRef.value : panelRef.value
    const option = root?.querySelector<HTMLElement>(`[data-select-index="${activeIndex.value}"]`)
    if (typeof option?.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' })
  })
}

function revealCascadeGroup(group: OptionGroup, focus: 'group' | 'option' = 'group') {
  if (!group.label) return
  openGroupKey.value = group.label
  cascadeFocus.value = focus
  if (focus === 'option') activeIndex.value = selectedOrFirstInGroup(group)
  void nextTick(() => {
    syncSubmenu()
    if (focus === 'option') scrollActiveIntoView()
  })
}

function show(): void {
  if (props.disabled || !props.options.length) return
  if (usesCascade.value) {
    openGroupKey.value = selectedGroupKey()
    cascadeFocus.value = 'group'
  }
  syncPanel()
  open.value = true
  activeIndex.value = selectedEnabledIndex()
  scrollActiveIntoView()
  if (usesCascade.value) void nextTick(() => syncSubmenu())
}

function toggle() {
  if (open.value) close()
  else show()
}

function close() {
  open.value = false
  openGroupKey.value = null
  cascadeFocus.value = 'group'
}

function pick(option: SelectOption) {
  if (option.disabled) return
  model.value = option.value
  close()
}

function moveActive(step: 1 | -1, list = props.options): void {
  if (!list.length) return
  const current = list.findIndex((_, index) => optionIndex(list[index]!) === activeIndex.value)
  let cursor = current
  for (let count = 0; count < list.length; count += 1) {
    cursor = (cursor + step + list.length) % list.length
    const option = list[cursor]
    if (option && !option.disabled) {
      activeIndex.value = optionIndex(option)
      scrollActiveIntoView()
      return
    }
  }
}

function moveCascadeGroup(step: 1 | -1): void {
  const groups = cascadeGroups.value
  if (!groups.length) return
  const current = Math.max(
    0,
    groups.findIndex((group) => group.label === openGroupKey.value)
  )
  const next = groups[(current + step + groups.length) % groups.length]
  if (next) revealCascadeGroup(next, 'group')
}

function onTriggerKey(e: KeyboardEvent): void {
  if (props.disabled) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) show()
    else if (usesCascade.value && cascadeFocus.value === 'group') {
      moveCascadeGroup(e.key === 'ArrowDown' ? 1 : -1)
    } else {
      moveActive(e.key === 'ArrowDown' ? 1 : -1, openGroup.value?.options ?? props.options)
    }
    return
  }
  if (usesCascade.value && open.value && e.key === 'ArrowRight' && cascadeFocus.value === 'group') {
    e.preventDefault()
    if (openGroup.value) revealCascadeGroup(openGroup.value, 'option')
    return
  }
  if (usesCascade.value && open.value && e.key === 'ArrowLeft' && cascadeFocus.value === 'option') {
    e.preventDefault()
    cascadeFocus.value = 'group'
    return
  }
  if (e.key === 'Home' && open.value) {
    e.preventDefault()
    if (usesCascade.value && cascadeFocus.value === 'group') {
      const first = cascadeGroups.value[0]
      if (first) revealCascadeGroup(first, 'group')
    } else {
      const list = openGroup.value?.options ?? props.options
      const option = list[firstEnabledIndex(list)]
      if (option) activeIndex.value = optionIndex(option)
      scrollActiveIntoView()
    }
    return
  }
  if (e.key === 'End' && open.value) {
    e.preventDefault()
    if (usesCascade.value && cascadeFocus.value === 'group') {
      const last = cascadeGroups.value[cascadeGroups.value.length - 1]
      if (last) revealCascadeGroup(last, 'group')
    } else {
      const list = openGroup.value?.options ?? props.options
      const option = list[lastEnabledIndex(list)]
      if (option) activeIndex.value = optionIndex(option)
      scrollActiveIntoView()
    }
    return
  }
  if ((e.key === 'Enter' || e.key === ' ') && open.value) {
    e.preventDefault()
    if (usesCascade.value && cascadeFocus.value === 'group') {
      if (openGroup.value) revealCascadeGroup(openGroup.value, 'option')
      return
    }
    const option = props.options[activeIndex.value]
    if (option) pick(option)
    return
  }
  if (e.key === 'Escape' && open.value) {
    e.preventDefault()
    e.stopPropagation()
  }
}

function onDocPointer(e: PointerEvent) {
  const t = e.target as Node
  if (rootRef.value?.contains(t) || panelRef.value?.contains(t) || submenuRef.value?.contains(t)) {
    return
  }
  close()
}

function onKey(e: KeyboardEvent) {
  if (!open.value || e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  if (usesCascade.value && cascadeFocus.value === 'option') {
    cascadeFocus.value = 'group'
    return
  }
  close()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', syncFloating)
  window.addEventListener('scroll', syncFloating, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', syncFloating)
  window.removeEventListener('scroll', syncFloating, true)
})

watch(open, (v) => {
  if (v) syncFloating()
  else {
    openGroupKey.value = null
    cascadeFocus.value = 'group'
  }
})

watch(
  () => [model.value, props.options] as const,
  () => {
    if (open.value) activeIndex.value = selectedEnabledIndex()
  }
)
</script>

<template>
  <div ref="rootRef" :class="fieldClasses">
    <label
      v-if="label"
      :for="selectId"
      class="text-[11.5px] font-medium text-[var(--text-secondary)]"
    >
      {{ label }}
    </label>
    <button
      :id="selectId"
      ref="triggerRef"
      type="button"
      :class="triggerClasses"
      :disabled="disabled"
      :aria-expanded="open"
      :aria-controls="usesCascade ? menuId : listboxId"
      :aria-activedescendant="activeDescendant"
      :aria-label="ariaLabel || undefined"
      :aria-haspopup="usesCascade ? 'menu' : 'listbox'"
      :aria-invalid="error ? 'true' : undefined"
      @click="toggle"
      @keydown="onTriggerKey"
    >
      <span
        class="min-w-0 flex-1 truncate"
        :class="selected ? '' : 'text-[var(--control-placeholder)]'"
      >
        {{ selectedLabel || placeholder || '' }}
      </span>
      <ChevronDown
        aria-hidden="true"
        class="size-3 shrink-0 text-[var(--text-tertiary)]"
        :stroke-width="1.75"
      />
    </button>
    <p
      v-if="error || hint"
      class="text-[10.5px] leading-snug"
      :class="[
        error ? 'text-[var(--error)]' : 'text-[var(--text-tertiary)]',
        layout === 'row' ? 'col-start-2' : ''
      ]"
    >
      {{ error || hint }}
    </p>
    <Teleport to="body">
      <div
        v-if="open && usesCascade"
        :id="menuId"
        ref="panelRef"
        role="menu"
        class="ui-select-menu pointer-events-auto fixed z-[110] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-popover)]"
        :style="panelStyle"
        @pointerdown.stop
      >
        <div class="ui-select-menu__list overflow-y-auto" :style="{ maxHeight: `${listMaxHeight}px` }">
          <button
            v-for="(group, groupIndex) in cascadeGroups"
            :id="vendorId(groupIndex)"
            :key="group.label ?? groupIndex"
            type="button"
            role="menuitem"
            tabindex="-1"
            :data-select-cascade-group="group.label"
            :data-select-cascade-index="groupIndex"
            :aria-haspopup="true"
            :aria-expanded="openGroupKey === group.label"
            class="ui-select-option flex w-full items-center justify-between gap-2 rounded-[4px] py-[6px] pl-2 pr-1.5 text-left text-[12.5px] text-[var(--text-primary)] outline-none"
            :class="openGroupKey === group.label ? 'ui-select-option--active' : ''"
            @pointerenter="revealCascadeGroup(group, 'group')"
            @mousedown.prevent="revealCascadeGroup(group, 'option')"
          >
            <span class="min-w-0 flex-1 truncate">{{ group.label }}</span>
            <Check
              v-if="groupHasSelected(group)"
              class="size-3 shrink-0 text-[var(--accent)]"
              :stroke-width="2"
            />
            <ChevronRight
              aria-hidden="true"
              class="size-3 shrink-0 text-[var(--text-tertiary)]"
              :stroke-width="1.75"
            />
          </button>
          <button
            v-for="opt in ungroupedOptions"
            :id="optionId(optionIndex(opt))"
            :key="opt.value"
            type="button"
            role="menuitem"
            tabindex="-1"
            :data-select-index="optionIndex(opt)"
            class="ui-select-option flex w-full items-center justify-between gap-2 rounded-[4px] py-[6px] pl-2 pr-2 text-left text-[12.5px] text-[var(--text-primary)] outline-none"
            :class="[
              opt.value === model ? 'ui-select-option--selected' : '',
              optionIndex(opt) === activeIndex ? 'ui-select-option--active' : '',
              opt.disabled ? 'cursor-not-allowed opacity-45' : ''
            ]"
            :disabled="opt.disabled"
            @pointermove="!opt.disabled && ((activeIndex = optionIndex(opt)), (cascadeFocus = 'option'))"
            @mousedown.prevent="pick(opt)"
          >
            <span
              class="min-w-0 flex-1 truncate"
              :class="mono ? 'font-[family-name:var(--font-mono)] text-[12px]' : ''"
            >
              {{ opt.label }}
            </span>
            <Check
              v-if="opt.value === model"
              class="size-3 shrink-0 text-[var(--accent)]"
              :stroke-width="2"
            />
          </button>
        </div>
      </div>
      <div
        v-if="open && usesCascade && openGroup"
        :id="listboxId"
        ref="submenuRef"
        role="listbox"
        :aria-label="openGroup.label ?? undefined"
        data-select-cascade-submenu
        class="ui-select-menu pointer-events-auto fixed z-[111] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-popover)]"
        :style="submenuStyle"
        @pointerdown.stop
        @pointerenter="cascadeFocus = 'option'"
      >
        <div
          class="ui-select-menu__list overflow-y-auto"
          :style="{ maxHeight: `${submenuMaxHeight}px` }"
        >
          <button
            v-for="opt in openGroup.options"
            :id="optionId(optionIndex(opt))"
            :key="opt.value"
            type="button"
            role="option"
            tabindex="-1"
            :data-select-index="optionIndex(opt)"
            class="ui-select-option flex w-full items-center justify-between gap-2 rounded-[4px] py-[6px] pl-2 pr-2 text-left text-[12.5px] text-[var(--text-primary)] outline-none"
            :class="[
              opt.value === model ? 'ui-select-option--selected' : '',
              optionIndex(opt) === activeIndex && cascadeFocus === 'option'
                ? 'ui-select-option--active'
                : '',
              opt.disabled ? 'cursor-not-allowed opacity-45' : ''
            ]"
            :disabled="opt.disabled"
            :aria-selected="opt.value === model"
            @pointermove="
              !opt.disabled && ((activeIndex = optionIndex(opt)), (cascadeFocus = 'option'))
            "
            @mousedown.prevent="pick(opt)"
          >
            <span
              class="min-w-0 flex-1 truncate"
              :class="mono ? 'font-[family-name:var(--font-mono)] text-[12px]' : ''"
            >
              {{ opt.label }}
            </span>
            <Check
              v-if="opt.value === model"
              class="size-3 shrink-0 text-[var(--accent)]"
              :stroke-width="2"
            />
          </button>
        </div>
      </div>
      <div
        v-else-if="open && !usesCascade"
        :id="listboxId"
        ref="panelRef"
        role="listbox"
        class="ui-select-menu pointer-events-auto fixed z-[110] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-popover)]"
        :style="panelStyle"
        @pointerdown.stop
      >
        <div class="ui-select-menu__list overflow-y-auto" :style="{ maxHeight: `${listMaxHeight}px` }">
          <div
            v-for="(group, groupIndex) in optionGroups"
            :key="group.label ?? `ungrouped-${groupIndex}`"
            :role="group.label ? 'group' : undefined"
            :aria-label="group.label ?? undefined"
            class="ui-select-group"
            :class="groupIndex > 0 ? 'ui-select-group--next' : ''"
          >
            <div
              v-if="group.label"
              class="ui-select-group__label px-2 pb-0.5 pt-1.5 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-tertiary)]"
            >
              {{ group.label }}
            </div>
            <button
              v-for="opt in group.options"
              :id="optionId(optionIndex(opt))"
              :key="opt.value"
              type="button"
              role="option"
              tabindex="-1"
              :data-select-index="optionIndex(opt)"
              class="ui-select-option flex w-full items-center justify-between gap-2 rounded-[4px] py-[6px] pr-2 text-left text-[12.5px] text-[var(--text-primary)] outline-none"
              :class="[
                opt.group ? 'pl-3' : 'pl-2',
                opt.value === model ? 'ui-select-option--selected' : '',
                optionIndex(opt) === activeIndex ? 'ui-select-option--active' : '',
                opt.disabled ? 'cursor-not-allowed opacity-45' : ''
              ]"
              :disabled="opt.disabled"
              :aria-selected="opt.value === model"
              @pointermove="!opt.disabled && (activeIndex = optionIndex(opt))"
              @mousedown.prevent="pick(opt)"
            >
              <span
                class="min-w-0 flex-1 truncate"
                :class="mono ? 'font-[family-name:var(--font-mono)] text-[12px]' : ''"
              >
                {{ opt.label }}
              </span>
              <Check
                v-if="opt.value === model"
                class="size-3 shrink-0 text-[var(--accent)]"
                :stroke-width="2"
              />
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
