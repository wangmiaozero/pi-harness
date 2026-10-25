<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/vue'
import { getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date'
import {
  RangeCalendarCell,
  RangeCalendarCellTrigger,
  RangeCalendarGrid,
  RangeCalendarGridBody,
  RangeCalendarGridHead,
  RangeCalendarGridRow,
  RangeCalendarHeadCell,
  RangeCalendarHeader,
  RangeCalendarHeading,
  RangeCalendarNext,
  RangeCalendarPrev,
  RangeCalendarRoot,
  type DateRange,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger
} from 'reka-ui'

defineProps<{ label: string }>()
const model = defineModel<{ start: string; end: string }>()
const { t, locale } = useI18n()
const open = ref(false)
const currentDay = shallowRef(today(getLocalTimeZone()))
const placeholder = shallowRef<DateValue>(currentDay.value)
const draft = shallowRef<DateRange>({ start: undefined, end: undefined })
const formatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
)
function format(day: DateValue) {
  return formatter.value.format(day.toDate(getLocalTimeZone()))
}
const display = computed(() =>
  model.value
    ? `${format(parseDate(model.value.start))} – ${format(parseDate(model.value.end))}`
    : ''
)

watch(open, (visible) => {
  if (!visible) return
  currentDay.value = today(getLocalTimeZone())
  draft.value = {
    start: model.value ? parseDate(model.value.start) : undefined,
    end: model.value ? parseDate(model.value.end) : undefined
  }
  placeholder.value = draft.value.start ?? currentDay.value
})

function select(range: DateRange) {
  draft.value = range
  if (!range.start || !range.end) return
  model.value = { start: range.start.toString(), end: range.end.toString() }
  open.value = false
}
function clear() {
  model.value = undefined
  open.value = false
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      class="history-date-trigger"
      :aria-label="label"
      data-testid="history-date-range"
    >
      <CalendarDays class="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate" :class="{ 'text-[var(--text-tertiary)]': !model }">
        {{ display || label }}
      </span>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="history-range-calendar"
        data-testid="history-range-calendar"
        align="start"
        :side-offset="8"
        :collision-padding="12"
        :aria-label="label"
        @open-auto-focus="(event) => event.preventDefault()"
      >
        <div class="mb-3 flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] p-2 text-xs">
          <div class="min-w-0 flex-1">
            <p class="text-[11px] text-[var(--text-tertiary)]">{{ t('universal.after') }}</p>
            <p class="mt-1 font-medium">{{ draft.start ? format(draft.start) : '—' }}</p>
          </div>
          <span class="text-[var(--text-tertiary)]" aria-hidden="true">→</span>
          <div class="min-w-0 flex-1 text-right">
            <p class="text-[11px] text-[var(--text-tertiary)]">{{ t('universal.before') }}</p>
            <p class="mt-1 font-medium">{{ draft.end ? format(draft.end) : '—' }}</p>
          </div>
        </div>
        <p class="mb-3 text-[11px] text-[var(--text-secondary)]" role="status" aria-live="polite">
          {{ t(draft.start && !draft.end ? 'universal.selectRangeEnd' : 'universal.selectRange') }}
        </p>
        <RangeCalendarRoot
          v-slot="{ grid, weekDays }"
          v-model:placeholder="placeholder"
          :model-value="draft"
          :locale="locale"
          :calendar-label="label"
          fixed-weeks
          initial-focus
          prevent-deselect
          @update:model-value="select"
        >
          <RangeCalendarHeader class="mb-3 flex items-center justify-between gap-2">
            <RangeCalendarPrev class="calendar-action" :aria-label="t('universal.previousMonth')">
              <ChevronLeft class="size-4" aria-hidden="true" />
            </RangeCalendarPrev>
            <RangeCalendarHeading class="text-[13px] font-semibold text-[var(--text-primary)]" />
            <RangeCalendarNext class="calendar-action" :aria-label="t('universal.nextMonth')">
              <ChevronRight class="size-4" aria-hidden="true" />
            </RangeCalendarNext>
          </RangeCalendarHeader>
          <RangeCalendarGrid
            v-for="month in grid"
            :key="month.value.toString()"
            class="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-1"
          >
            <RangeCalendarGridHead>
              <RangeCalendarGridRow>
                <RangeCalendarHeadCell
                  v-for="(day, index) in weekDays"
                  :key="index"
                  class="pb-2 text-[11px] font-medium text-[var(--text-tertiary)]"
                >
                  {{ day }}
                </RangeCalendarHeadCell>
              </RangeCalendarGridRow>
            </RangeCalendarGridHead>
            <RangeCalendarGridBody>
              <RangeCalendarGridRow v-for="(week, index) in month.rows" :key="index">
                <RangeCalendarCell
                  v-for="day in week"
                  :key="day.toString()"
                  :date="day"
                  class="calendar-cell p-0"
                >
                  <RangeCalendarCellTrigger
                    :day="day"
                    :month="month.value"
                    as="button"
                    class="calendar-day"
                  />
                </RangeCalendarCell>
              </RangeCalendarGridRow>
            </RangeCalendarGridBody>
          </RangeCalendarGrid>
        </RangeCalendarRoot>
        <div class="mt-3 flex justify-between border-t border-[var(--border-subtle)] pt-2">
          <button type="button" class="calendar-footer-action" @click="clear">
            {{ t('universal.clearRange') }}
          </button>
          <button
            type="button"
            class="calendar-footer-action"
            @click="select({ start: currentDay, end: currentDay })"
          >
            {{ t('universal.today') }}
          </button>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
.history-date-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--control-bg);
  color: var(--text-primary);
  text-align: left;
  font-size: 12px;
  box-shadow: var(--control-shadow);
}
.history-date-trigger:hover {
  border-color: var(--control-border-hover);
  background: var(--control-bg-hover);
}
:global(.history-range-calendar) {
  z-index: 90;
  width: 300px;
  max-width: calc(100vw - 24px);
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-surface-raised);
  color: var(--text-primary);
  box-shadow: var(--shadow-dialog);
  backdrop-filter: blur(24px);
}
.calendar-action {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
.calendar-day {
  position: relative;
  width: 100%;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.calendar-action:hover,
.calendar-day:hover,
.calendar-footer-action:hover {
  background: var(--accent-tint);
  color: var(--accent);
}
.calendar-day[data-outside-view] {
  color: var(--text-tertiary);
}
.calendar-day[data-today]::after {
  position: absolute;
  bottom: 3px;
  left: calc(50% - 1.5px);
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--accent);
  content: '';
}
.calendar-cell:has(.calendar-day[data-selected]),
.calendar-cell:has(.calendar-day[data-highlighted]) {
  background: var(--accent-tint);
}
.calendar-cell:first-child,
.calendar-cell:has(.calendar-day[data-selection-start]),
.calendar-cell:has(.calendar-day[data-highlighted-start]) {
  border-top-left-radius: var(--radius-sm);
  border-bottom-left-radius: var(--radius-sm);
}
.calendar-cell:last-child,
.calendar-cell:has(.calendar-day[data-selection-end]),
.calendar-cell:has(.calendar-day[data-highlighted-end]) {
  border-top-right-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}
.calendar-day[data-selection-start],
.calendar-day[data-selection-end] {
  background: var(--accent-solid);
  color: var(--text-on-accent);
}
.calendar-day[data-selection-start]::after,
.calendar-day[data-selection-end]::after {
  background: white;
}
.calendar-day[data-disabled],
.calendar-action:disabled,
.calendar-footer-action:disabled {
  opacity: 0.35;
  pointer-events: none;
}
.calendar-footer-action {
  padding: 5px 9px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 12px;
}
.history-date-trigger:focus-visible,
.calendar-action:focus-visible,
.calendar-day:focus-visible,
.calendar-footer-action:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
