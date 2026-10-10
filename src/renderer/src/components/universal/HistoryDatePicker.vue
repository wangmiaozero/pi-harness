<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/vue'
import { getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date'
import {
  CalendarCell,
  CalendarCellTrigger,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHead,
  CalendarGridRow,
  CalendarHeadCell,
  CalendarHeader,
  CalendarHeading,
  CalendarNext,
  CalendarPrev,
  CalendarRoot,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger
} from 'reka-ui'

const props = defineProps<{ label: string; min?: string; max?: string }>()
const model = defineModel<string>({ default: '' })
const { t, locale } = useI18n()
const open = ref(false)
const currentDay = shallowRef(today(getLocalTimeZone()))
const placeholder = shallowRef<DateValue>(currentDay.value)
const value = computed(() => (model.value ? parseDate(model.value) : null))
const minimum = computed(() => (props.min ? parseDate(props.min) : undefined))
const maximum = computed(() => (props.max ? parseDate(props.max) : undefined))
const display = computed(() =>
  value.value
    ? new Intl.DateTimeFormat(locale.value, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(value.value.toDate(getLocalTimeZone()))
    : props.label
)
const todayDisabled = computed(
  () =>
    (minimum.value && currentDay.value.compare(minimum.value) < 0) ||
    (maximum.value && currentDay.value.compare(maximum.value) > 0)
)

watch(open, (visible) => {
  if (!visible) return
  currentDay.value = today(getLocalTimeZone())
  let initial = value.value ?? currentDay.value
  if (minimum.value && initial.compare(minimum.value) < 0) initial = minimum.value
  if (maximum.value && initial.compare(maximum.value) > 0) initial = maximum.value
  placeholder.value = initial
})

function select(day: DateValue | undefined) {
  model.value = day?.toString() ?? ''
  open.value = false
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger class="history-date-trigger" :aria-label="label">
      <span class="min-w-0 flex-1 truncate" :class="{ 'text-[var(--text-tertiary)]': !model }">
        {{ display }}
      </span>
      <CalendarDays class="size-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="history-calendar"
        align="start"
        :side-offset="8"
        :collision-padding="12"
        :aria-label="label"
        @open-auto-focus="(event) => event.preventDefault()"
      >
        <CalendarRoot
          v-slot="{ grid, weekDays }"
          v-model:placeholder="placeholder"
          :model-value="value"
          :locale="locale"
          :calendar-label="label"
          :min-value="minimum"
          :max-value="maximum"
          fixed-weeks
          initial-focus
          prevent-deselect
          @update:model-value="select"
        >
          <CalendarHeader class="mb-3 flex items-center justify-between gap-2">
            <CalendarPrev class="calendar-action" :aria-label="t('universal.previousMonth')">
              <ChevronLeft class="size-4" aria-hidden="true" />
            </CalendarPrev>
            <CalendarHeading class="text-[13px] font-semibold text-[var(--text-primary)]" />
            <CalendarNext class="calendar-action" :aria-label="t('universal.nextMonth')">
              <ChevronRight class="size-4" aria-hidden="true" />
            </CalendarNext>
          </CalendarHeader>
          <CalendarGrid
            v-for="month in grid"
            :key="month.value.toString()"
            class="w-full table-fixed border-separate border-spacing-1"
          >
            <CalendarGridHead>
              <CalendarGridRow>
                <CalendarHeadCell
                  v-for="(day, index) in weekDays"
                  :key="index"
                  class="pb-2 text-[11px] font-medium text-[var(--text-tertiary)]"
                >
                  {{ day }}
                </CalendarHeadCell>
              </CalendarGridRow>
            </CalendarGridHead>
            <CalendarGridBody>
              <CalendarGridRow v-for="(week, index) in month.rows" :key="index">
                <CalendarCell v-for="day in week" :key="day.toString()" :date="day" class="p-0">
                  <CalendarCellTrigger
                    :day="day"
                    :month="month.value"
                    as="button"
                    class="calendar-day"
                  />
                </CalendarCell>
              </CalendarGridRow>
            </CalendarGridBody>
          </CalendarGrid>
        </CalendarRoot>
        <div class="mt-3 flex justify-between border-t border-[var(--border-subtle)] pt-2">
          <button type="button" class="calendar-footer-action" @click="select(undefined)">
            {{ t('universal.clearDate') }}
          </button>
          <button
            type="button"
            class="calendar-footer-action"
            :disabled="!!todayDisabled"
            @click="select(currentDay)"
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
:global(.history-calendar) {
  z-index: 90;
  width: 280px;
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
.calendar-day[data-selected],
.calendar-day[data-selected]:hover {
  background: var(--accent);
  color: white;
}
.calendar-day[data-selected]::after {
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
