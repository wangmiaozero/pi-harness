<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { GitActivityDay } from '@shared/types/workspace'

/**
 * GitHub-style contribution grid for one repository, following WangmiaoGit's
 * ActivityGraph: a column per week, a cell per day, brighter the more
 * commits landed that day. Shading is relative to the repo's own activity
 * (quartiles of the busiest days), so a quiet repo and a busy one both
 * read. Empty days keep a faint tint so the lattice stays visible.
 *
 * The grid is sized from the width it is offered, never from its own
 * content (the reference app's rule): a fixed 9px cell needs ~300px for
 * 26 weeks and hangs off a 256px sidebar, so the cell size is computed to
 * fill the pane instead, clamped to a readable range, and the number of
 * weeks follows what fits.
 */
const props = withDefaults(
  defineProps<{
    days: GitActivityDay[]
    /** How many weeks to draw at most. */
    maxWeeks?: number
  }>(),
  { maxWeeks: 26 }
)

interface Cell {
  date: string
  commits: number
  future: boolean
  level: number
  tooltip: string
}

const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']

const LABEL_WIDTH = 18
const GAP = 2
const CELL_MIN = 5
const CELL_MAX = 11

const root = ref<HTMLElement | null>(null)
const availableWidth = ref(0)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!root.value) return
  observer = new ResizeObserver((entries) => {
    availableWidth.value = entries[0]?.contentRect.width ?? 0
  })
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

/** The cell size at which the full window fills the pane, clamped. */
const cellSize = computed(() => {
  if (!availableWidth.value) return 9
  const usable = availableWidth.value - LABEL_WIDTH
  const fitted = (usable - GAP * props.maxWeeks) / props.maxWeeks
  return Math.max(CELL_MIN, Math.min(CELL_MAX, fitted))
})

/** As many weeks as fit at that cell size, capped by the data window. */
const weekCount = computed(() => {
  if (!availableWidth.value) return props.maxWeeks
  const usable = availableWidth.value - LABEL_WIDTH
  const fits = Math.floor((usable + GAP) / (cellSize.value + GAP))
  return Math.max(1, Math.min(props.maxWeeks, fits))
})

const countsByDate = computed(() => {
  const map = new Map<string, number>()
  for (const day of props.days) map.set(day.date, day.commits)
  return map
})

const weeks = computed<Cell[][]>(() => {
  if (!props.days.length) return []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // Anchor the last column to the current, part-finished week, like a calendar.
  const intoWeek = (today.getDay() + 6) % 7 // Monday-based
  const first = new Date(today)
  first.setDate(first.getDate() - (intoWeek + 7 * (weekCount.value - 1)))
  const oldest = props.days.find((day) => day.commits > 0)?.date
  const columns: Cell[][] = []
  for (let week = 0; week < weekCount.value; week++) {
    const column: Cell[] = []
    for (let row = 0; row < 7; row++) {
      const date = new Date(first)
      date.setDate(first.getDate() + week * 7 + row)
      const key = formatDate(date)
      const commits = countsByDate.value.get(key) ?? 0
      const future = date > today
      const prehistory = oldest ? key < oldest : true
      column.push({
        date: key,
        commits: future ? 0 : commits,
        future,
        level: future || prehistory || commits === 0 ? 0 : levelFor(commits),
        tooltip: tooltipFor(key, commits, future)
      })
    }
    columns.push(column)
  }
  return columns
})

/** 90th percentile of active days, floored at 4 — the darkest-step anchor. */
const peak = computed(() => {
  const active = props.days
    .filter((day) => day.commits > 0)
    .map((day) => day.commits)
    .sort((a, b) => a - b)
  if (!active.length) return 1
  return Math.max(4, active[Math.min(active.length - 1, Math.floor(active.length * 0.9))]!)
})

function levelFor(commits: number): number {
  if (commits <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((commits * 4) / peak.value)))
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function tooltipFor(key: string, commits: number, future: boolean): string {
  if (future) return ''
  const date = new Date(`${key}T00:00:00`)
  const label = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(date)
  return `${commits} · ${label}`
}

const summary = computed(() => {
  const total = props.days.reduce((sum, day) => sum + day.commits, 0)
  if (!total) return ''
  const weeksAlive = Math.max(
    1,
    Math.min(weekCount.value, Math.ceil(props.days.filter((d) => d.commits > 0).length / 7))
  )
  return `${total} · ${weeksAlive}w`
})

function cellClass(cell: Cell): string {
  if (cell.future) return 'activity-cell activity-cell--future'
  if (cell.level === 0) return 'activity-cell activity-cell--empty'
  return `activity-cell activity-cell--l${cell.level}`
}
</script>

<template>
  <div
    ref="root"
    class="flex w-full flex-col gap-1"
    data-testid="git-activity-graph"
    role="img"
    :aria-label="$t('workspace.gitActivityLabel')"
  >
    <div v-if="weeks.length" class="flex items-start justify-center gap-[2px]">
      <div
        class="flex shrink-0 flex-col gap-[2px] pt-[1px]"
        :style="{ width: `${LABEL_WIDTH}px` }"
      >
        <span
          v-for="(label, index) in WEEKDAY_LABELS"
          :key="index"
          class="text-right text-[7.5px] text-[var(--text-tertiary)]"
          :style="{ height: `${cellSize}px`, lineHeight: `${cellSize}px` }"
        >
          {{ label }}
        </span>
      </div>
      <div
        v-for="(week, weekIndex) in weeks"
        :key="weekIndex"
        class="flex flex-col gap-[2px]"
      >
        <div
          v-for="cell in week"
          :key="cell.date"
          :class="cellClass(cell)"
          :style="{ width: `${cellSize}px`, height: `${cellSize}px` }"
          :title="cell.tooltip"
        />
      </div>
    </div>
    <span
      v-if="summary"
      class="self-center text-[9px] text-[var(--text-tertiary)]"
    >
      {{ summary }}
    </span>
  </div>
</template>

<style scoped>
.activity-cell {
  border-radius: 2px;
  background: color-mix(in srgb, var(--text-primary) 9%, transparent);
}

.activity-cell--future {
  background: color-mix(in srgb, var(--text-primary) 4%, transparent);
}

.activity-cell--empty {
  background: color-mix(in srgb, var(--text-primary) 9%, transparent);
}

/* Four calm accent steps, relative to the repo's own activity. */
.activity-cell--l1 {
  background: color-mix(in srgb, var(--accent) 28%, transparent);
}

.activity-cell--l2 {
  background: color-mix(in srgb, var(--accent) 48%, transparent);
}

.activity-cell--l3 {
  background: color-mix(in srgb, var(--accent) 70%, transparent);
}

.activity-cell--l4 {
  background: color-mix(in srgb, var(--accent) 92%, transparent);
}
</style>
