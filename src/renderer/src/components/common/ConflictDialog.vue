<script setup lang="ts">
/**
 * Configuration Conflict Dialog
 *
 * Mounted once at app shell level (App.vue) and driven by `useConfigConflict()`.
 * Shows lastLoaded vs currentDisk as a line diff and offers four actions:
 *   - Reload   — discard Pi-Switch edits, re-read disk (resolveConflict('reload'))
 *   - Compare  — toggle inline diff view (no resolution, just inspection)
 *   - Overwrite — confirm + resolveConflict('overwrite') (caller will backup-then-write)
 *   - Cancel   — resolveConflict('cancel')
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, ArrowLeftRight, Eye, EyeOff, RotateCcw, Save, X, Circle } from '@lucide/vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Button from '@renderer/components/ui/Button.vue'
import { useConfigConflict, type ConflictResolution } from '@renderer/composables/useConfigConflict'
import { diffLines, diffSummary } from '@shared/utils/diff'

const { t, locale } = useI18n()
const { state, resolveConflict } = useConfigConflict()

const showCompare = ref(false)
const confirmOverwrite = ref(false)
const open = computed({
  get: () => state.open,
  set: (v) => {
    if (!v) resolveConflict('cancel')
  }
})

const diffResult = computed(() => {
  if (!state.snapshot) return null
  return diffLines(state.snapshot.lastLoaded, state.snapshot.currentDisk)
})

const summary = computed(() => (diffResult.value ? diffSummary(diffResult.value) : ''))

watch(
  () => state.open,
  (o) => {
    if (o) {
      showCompare.value = false
      confirmOverwrite.value = false
    }
  }
)

function decide(resolution: ConflictResolution) {
  resolveConflict(resolution)
}

function formatTime(ms: number | null): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (locale.value === 'zh-CN') {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  return d.toLocaleString(locale.value, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const fileLabel = computed(() => (state.file === 'models' ? 'models.json' : 'settings.json'))
</script>

<template>
  <Dialog
    v-model:open="open"
    wide
    :title="t('conflict.title', { file: fileLabel })"
    :description="t('conflict.description')"
  >
    <div v-if="state.snapshot" class="flex flex-col gap-3">
      <div
        class="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-[var(--warning)]/30 bg-[var(--warning-tint)] px-3 py-2.5 text-[12px] text-[var(--text-primary)]"
      >
        <AlertTriangle
          class="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]"
          :stroke-width="1.75"
        />
        <p>
          {{ t('conflict.message') }}
          <span
            v-if="summary"
            class="ml-1 font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-secondary)]"
          >
            ({{ summary }})
          </span>
        </p>
      </div>

      <dl class="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt class="text-[var(--text-tertiary)]">{{ t('conflict.file') }}</dt>
        <dd
          class="truncate font-[family-name:var(--font-mono)] text-[var(--text-primary)]"
          :title="state.snapshot.path"
        >
          {{ state.snapshot.path }}
        </dd>

        <dt class="text-[var(--text-tertiary)]">{{ t('conflict.lastLoaded') }}</dt>
        <dd class="text-[var(--text-primary)]">
          {{ formatTime(state.snapshot.lastMtime) }}
        </dd>

        <dt class="text-[var(--text-tertiary)]">{{ t('conflict.currentDisk') }}</dt>
        <dd class="text-[var(--text-primary)]">
          {{ formatTime(state.snapshot.currentMtime) }}
        </dd>
      </dl>

      <div
        v-if="showCompare && diffResult"
        class="max-h-[40vh] overflow-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] font-[family-name:var(--font-mono)] text-[11.5px] leading-[1.55]"
      >
        <div class="grid grid-cols-2 divide-x divide-[var(--border-subtle)]">
          <div>
            <div
              class="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]"
            >
              {{ t('conflict.lastLoaded') }}
            </div>
            <div
              v-for="(line, idx) in diffResult.lines"
              :key="`l-${idx}`"
              class="flex"
              :class="{
                'bg-[var(--diff-removed-bg)] text-[var(--diff-removed-text)]':
                  line.op === 'removed',
                'opacity-40': line.op === 'added'
              }"
            >
              <span
                class="inline-block w-10 shrink-0 select-none border-r border-[var(--border-subtle)] px-2 py-0.5 text-right text-[var(--diff-gutter-text)]"
              >
                {{ line.lineNumber }}
              </span>
              <span class="flex-1 whitespace-pre px-2 py-0.5">{{ line.text }}</span>
            </div>
          </div>
          <div>
            <div
              class="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]"
            >
              {{ t('conflict.currentDisk') }}
            </div>
            <div
              v-for="(line, idx) in diffResult.lines"
              :key="`r-${idx}`"
              class="flex"
              :class="{
                'bg-[var(--diff-added-bg)] text-[var(--diff-added-text)]': line.op === 'added',
                'opacity-40': line.op === 'removed'
              }"
            >
              <span
                class="inline-block w-10 shrink-0 select-none border-r border-[var(--border-subtle)] px-2 py-0.5 text-right text-[var(--diff-gutter-text)]"
              >
                {{ line.op === 'added' ? idx + 1 : '' }}
              </span>
              <span class="flex-1 whitespace-pre px-2 py-0.5">{{
                line.op === 'added' ? line.text : ''
              }}</span>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="confirmOverwrite"
        class="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-[var(--error)]/30 bg-[var(--error-tint)] px-3 py-2.5 text-[12px] text-[var(--text-primary)]"
      >
        <Circle class="mt-1 size-2 shrink-0 fill-current text-[var(--error)]" :stroke-width="0" />
        {{ t('conflict.overwriteWarning') }}
      </div>
    </div>
    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" @click="showCompare = !showCompare">
          <component :is="showCompare ? EyeOff : Eye" class="size-3.5" :stroke-width="1.75" />
          {{ showCompare ? t('conflict.hideCompare') : t('conflict.compare') }}
        </Button>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" @click="decide('cancel')">
            <X class="size-3.5" :stroke-width="1.75" />
            {{ t('conflict.cancel') }}
          </Button>
          <Button variant="secondary" size="sm" @click="decide('reload')">
            <RotateCcw class="size-3.5" :stroke-width="1.75" />
            {{ t('conflict.reload') }}
          </Button>
          <Button
            v-if="!confirmOverwrite"
            variant="primary"
            size="sm"
            @click="confirmOverwrite = true"
          >
            <ArrowLeftRight class="size-3.5" :stroke-width="1.75" />
            {{ t('conflict.overwrite') }}
          </Button>
          <Button v-else variant="danger" size="sm" @click="decide('overwrite')">
            <Save class="size-3.5" :stroke-width="1.75" />
            {{ t('conflict.confirmOverwrite') }}
          </Button>
        </div>
      </div>
    </template>
  </Dialog>
</template>
