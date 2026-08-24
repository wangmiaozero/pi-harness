<script setup lang="ts">
import { computed } from 'vue'
import { Ban, CheckCircle2, CircleAlert, LoaderCircle } from '@lucide/vue'
import type { EnvironmentInstallTask } from '@shared/ipc/api-types'
import Button from '@renderer/components/ui/Button.vue'

const props = defineProps<{ task: EnvironmentInstallTask }>()
defineEmits<{ cancel: [] }>()

const statusTone = computed(() => {
  if (props.task.state === 'success') return 'text-[var(--success)]'
  if (props.task.state === 'failed') return 'text-[var(--error)]'
  if (props.task.state === 'cancelled') return 'text-[var(--warning)]'
  return 'text-[var(--accent)]'
})

function time(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(value)
}
</script>

<template>
  <div
    data-testid="environment-install-task"
    class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-window)] p-3"
  >
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <LoaderCircle
          v-if="task.state === 'running'"
          class="size-3.5 shrink-0 animate-spin"
          :class="statusTone"
        />
        <CheckCircle2
          v-else-if="task.state === 'success'"
          class="size-3.5 shrink-0"
          :class="statusTone"
        />
        <Ban v-else-if="task.state === 'cancelled'" class="size-3.5 shrink-0" :class="statusTone" />
        <CircleAlert v-else class="size-3.5 shrink-0" :class="statusTone" />
        <span class="truncate text-[11.5px] font-medium text-[var(--text-primary)]">
          {{ task.message }}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]">
          {{ task.progress }}%
        </span>
        <Button
          v-if="task.state === 'running' && task.cancellable"
          variant="ghost"
          size="sm"
          @click="$emit('cancel')"
        >
          {{ $t('overview.cancelInstall') }}
        </Button>
      </div>
    </div>
    <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-hover)]">
      <div
        class="h-full rounded-full transition-[width] duration-300"
        :class="task.state === 'failed' ? 'bg-[var(--error)]' : 'bg-[var(--accent)]'"
        :style="{ width: `${task.progress}%` }"
      />
    </div>
    <p class="mt-1.5 font-[family-name:var(--font-mono)] text-[9.5px] text-[var(--text-disabled)]">
      {{ task.phase }}
    </p>
    <details v-if="task.logs.length" open class="mt-2 border-t border-[var(--border-subtle)] pt-2">
      <summary class="cursor-pointer text-[10.5px] font-medium text-[var(--text-tertiary)]">
        {{ $t('overview.installLogs') }} ({{ task.logs.length }})
      </summary>
      <div
        class="mt-1.5 max-h-48 space-y-0.5 overflow-auto rounded-[4px] bg-[var(--bg-workspace)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-[10px]"
      >
        <p
          v-for="(entry, index) in task.logs"
          :key="`${entry.at}:${index}`"
          :class="
            entry.level === 'error' || entry.level === 'stderr'
              ? 'text-[var(--error)]'
              : entry.level === 'warning'
                ? 'text-[var(--warning)]'
                : 'text-[var(--text-secondary)]'
          "
        >
          <span class="text-[var(--text-disabled)]">[{{ time(entry.at) }}]</span>
          {{ entry.message }}
        </p>
      </div>
    </details>
  </div>
</template>
