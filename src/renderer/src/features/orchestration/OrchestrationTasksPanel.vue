<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ListTree, Plus, RotateCcw, SkipForward, Trash2, UserRoundCog } from '@lucide/vue'
import { useOrchestrationStore } from '@renderer/stores/orchestration'
import type { HarnessTask } from '@shared/types/harness'

const { t } = useI18n()
const store = useOrchestrationStore()

const showForm = ref(false)
const form = ref({
  title: '',
  description: '',
  priority: 'normal' as 'low' | 'normal' | 'high' | 'critical',
  assignedAgentId: '' as string,
  dependencies: '' as string,
  reviewRequired: false
})

const tasks = computed<HarnessTask[]>(() => store.snapshot?.tasks ?? [])
const busyTaskId = ref<string | null>(null)

const agentNameById = computed<Map<string, string>>(
  () =>
    new Map((store.snapshot?.agents ?? []).map((item) => [item.agent.id, item.agent.name]))
)

const taskKeyById = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  const byId = new Map(tasks.value.map((task) => [task.id, task]))
  for (const task of tasks.value) {
    const key = shortTitle(task)
    map.set(task.id, key)
    void byId
  }
  return map
})

function shortTitle(task: HarnessTask): string {
  return task.title.length > 24 ? `${task.title.slice(0, 24)}…` : task.title
}

function dependencyLabels(task: HarnessTask): string[] {
  return task.dependencies.map(
    (depId) => taskKeyById.value.get(depId) ?? depId.slice(0, 8)
  )
}

const statusTone: Record<string, string> = {
  pending: 'text-[var(--text-tertiary)]',
  ready: 'text-[var(--accent)]',
  running: 'text-[var(--success)]',
  waiting: 'text-[var(--warning)]',
  blocked: 'text-[var(--error)]',
  verifying: 'text-[var(--warning)]',
  review: 'text-[var(--accent)]',
  completed: 'text-[var(--success)]',
  failed: 'text-[var(--error)]',
  cancelled: 'text-[var(--text-tertiary)]'
}

async function submit(): Promise<void> {
  const deps = form.value.dependencies
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  await store.createTask({
    title: form.value.title.trim() || 'Task',
    description: form.value.description.trim() || null,
    priority: form.value.priority,
    assignedAgentId: form.value.assignedAgentId || null,
    dependencies: deps,
    reviewRequired: form.value.reviewRequired
  })
  showForm.value = false
  form.value = {
    title: '',
    description: '',
    priority: 'normal',
    assignedAgentId: '',
    dependencies: '',
    reviewRequired: false
  }
}

async function action(taskId: string, op: () => Promise<void>): Promise<void> {
  busyTaskId.value = taskId
  try {
    await op()
  } finally {
    busyTaskId.value = null
  }
}

async function reassign(task: HarnessTask): Promise<void> {
  const agentIds = [...agentNameById.value.keys()].filter((id) => id !== task.assignedAgentId)
  const next = agentIds[0]
  if (!next) return
  await action(task.id, () => store.reassignTask(task.id, next))
}

async function retry(task: HarnessTask): Promise<void> {
  await action(task.id, () => store.retryTask(task.id, null))
}

async function skip(task: HarnessTask): Promise<void> {
  await action(task.id, () => store.skipTask(task.id))
}

async function remove(task: HarnessTask): Promise<void> {
  await action(task.id, () => store.deleteTask(task.id))
}
</script>

<template>
  <section class="harness-card" data-testid="orchestration-tasks-panel">
    <div class="flex items-center justify-between gap-2">
      <h3 class="harness-card-title">{{ t('orchestration.tasksTitle') }}</h3>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-1 text-[11px] text-[var(--accent)] transition-colors hover:brightness-95 disabled:opacity-50"
        :disabled="!store.currentId || store.mutating"
        data-testid="orchestration-task-add"
        @click="showForm = !showForm"
      >
        <Plus class="size-3" />
        {{ t('orchestration.taskAdd') }}
      </button>
    </div>
    <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">{{ t('orchestration.tasksHint') }}</p>

    <form
      v-if="showForm"
      class="mt-3 grid gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:grid-cols-2"
      data-testid="orchestration-task-form"
      @submit.prevent="submit"
    >
      <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('orchestration.taskTitle') }}
        <input
          v-model="form.title"
          required
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('orchestration.taskPriority') }}
        <select
          v-model="form.priority"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
        >
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
          <option value="critical">critical</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('orchestration.taskAssignee') }}
        <select
          v-model="form.assignedAgentId"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
        >
          <option value="">{{ t('orchestration.taskAutoAssign') }}</option>
          <option v-for="snapshot in store.snapshot?.agents ?? []" :key="snapshot.agent.id" :value="snapshot.agent.id">
            {{ snapshot.agent.name }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('orchestration.taskDependencies') }}
        <input
          v-model="form.dependencies"
          :placeholder="t('orchestration.taskDependenciesPlaceholder')"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10.5px] text-[var(--text-tertiary)] sm:col-span-2">
        {{ t('orchestration.taskDescription') }}
        <textarea
          v-model="form.description"
          rows="2"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
        />
      </label>
      <label class="flex items-center gap-2 text-[10.5px] text-[var(--text-secondary)]">
        <input v-model="form.reviewRequired" type="checkbox" class="size-3" />
        {{ t('orchestration.taskReviewRequired') }}
      </label>
      <div class="flex items-center gap-2 sm:col-span-2">
        <button
          type="submit"
          class="rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2.5 py-1 text-[11px] text-[var(--accent)]"
          :disabled="store.mutating"
        >
          {{ t('common.save') }}
        </button>
        <button
          type="button"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
          @click="showForm = false"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </form>

    <p v-if="!tasks.length" class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ t('orchestration.tasksEmpty') }}
    </p>

    <ol v-else class="mt-3 space-y-2">
      <li
        v-for="task in tasks"
        :key="task.id"
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        data-testid="orchestration-task-card"
      >
        <div class="flex flex-wrap items-center gap-2 text-[11.5px]">
          <span class="font-medium text-[var(--text-primary)]">{{ task.title }}</span>
          <span
            class="rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px]"
            :class="statusTone[task.status]"
          >
            {{ task.status }}
          </span>
          <span
            v-if="task.priority !== 'normal'"
            class="rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]"
          >
            {{ task.priority }}
          </span>
          <span class="text-[10.5px] text-[var(--text-tertiary)]">
            {{
              task.assignedAgentId
                ? (agentNameById.get(task.assignedAgentId) ?? '—')
                : t('orchestration.taskAutoAssign')
            }}
          </span>
          <span
            v-if="task.reviewRequired"
            class="rounded-full border border-[var(--accent-border)] bg-[var(--accent-tint)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]"
          >
            review
          </span>
          <span
            v-if="task.reviewVerdict === 'rejected'"
            class="text-[10px] text-[var(--error)]"
          >
            {{ t('orchestration.taskRejected') }}
          </span>
          <span v-if="task.retryCount > 0" class="text-[10px] text-[var(--text-tertiary)]">
            ×{{ task.retryCount }}
          </span>
        </div>
        <p v-if="task.description" class="mt-1 text-[10.5px] text-[var(--text-tertiary)]">
          {{ task.description }}
        </p>
        <p v-if="task.error" class="mt-1 text-[10.5px] text-[var(--error)]">{{ task.error }}</p>
        <p v-if="task.reviewSummary" class="mt-1 text-[10.5px] text-[var(--text-tertiary)]">
          {{ task.reviewSummary }}
        </p>
        <div class="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
          <span v-if="dependencyLabels(task).length" class="inline-flex items-center gap-1">
            <ListTree class="size-3" />
            {{ t('orchestration.taskDependsOn') }}: {{ dependencyLabels(task).join(', ') }}
          </span>
          <span v-if="task.artifactIds.length">
            {{ t('orchestration.taskArtifacts') }}: {{ task.artifactIds.length }}
          </span>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[10.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="busyTaskId !== null || task.status === 'running'"
            :title="t('orchestration.taskRetryHint')"
            @click="retry(task)"
          >
            <RotateCcw class="size-3" />
            {{ t('orchestration.taskRetry') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[10.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="busyTaskId !== null || task.status === 'running'"
            :title="t('orchestration.taskSkipHint')"
            @click="skip(task)"
          >
            <SkipForward class="size-3" />
            {{ t('orchestration.taskSkip') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[10.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="busyTaskId !== null || (store.snapshot?.agents.length ?? 0) < 2 || task.status === 'running'"
            :title="t('orchestration.taskReassignHint')"
            @click="reassign(task)"
          >
            <UserRoundCog class="size-3" />
            {{ t('orchestration.taskReassign') }}
          </button>
          <button
            type="button"
            class="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 text-[10.5px] text-[var(--error)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="busyTaskId !== null || task.status === 'running'"
            @click="remove(task)"
          >
            <Trash2 class="size-3" />
            {{ t('common.delete') }}
          </button>
        </div>
      </li>
    </ol>
  </section>
</template>
