<script setup lang="ts">
import { ref } from 'vue'
import type { HarnessState } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'

defineProps<{ state: HarnessState }>()

const harness = useHarnessStore()
const steeringMessage = ref('')
const followUpMessage = ref('')

async function changeThinking(event: Event) {
  await safely(harness.setThinkingLevel((event.target as HTMLSelectElement).value))
}

async function queueSteering() {
  const message = steeringMessage.value.trim()
  if (!message) return
  await safely(harness.steer(message))
  if (!harness.error) steeringMessage.value = ''
}

async function queueFollowUp() {
  const message = followUpMessage.value.trim()
  if (!message) return
  await safely(harness.followUp(message))
  if (!harness.error) followUpMessage.value = ''
}

async function safely(operation: Promise<unknown>) {
  try {
    await operation
  } catch {
    /* Store exposes the sanitized error in the console. */
  }
}
</script>

<template>
  <div class="grid gap-3 xl:grid-cols-2">
    <section class="harness-card">
      <h3 class="harness-card-title">{{ $t('workspace.harnessRuntime') }}</h3>
      <dl class="mt-3 grid grid-cols-[minmax(110px,0.7fr)_1fr] gap-x-4 gap-y-2 text-[12px]">
        <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.sessionId') }}</dt>
        <dd class="truncate font-mono text-[var(--text-primary)]">{{ state.sessionId }}</dd>
        <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.harnessStatus') }}</dt>
        <dd class="capitalize text-[var(--text-primary)]">{{ state.runtime.status }}</dd>
        <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.model') }}</dt>
        <dd class="truncate text-[var(--text-primary)]">
          {{ state.model ? `${state.model.provider} / ${state.model.id}` : '—' }}
        </dd>
        <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.streaming') }}</dt>
        <dd>{{ state.runtime.isStreaming ? $t('common.yes') : $t('common.no') }}</dd>
        <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.harnessPromptRunning') }}</dt>
        <dd>{{ state.runtime.isPromptRunning ? $t('common.yes') : $t('common.no') }}</dd>
        <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.harnessBashRunning') }}</dt>
        <dd>{{ state.runtime.isBashRunning ? $t('common.yes') : $t('common.no') }}</dd>
      </dl>
      <div class="mt-4 flex items-center gap-2">
        <label class="text-[11px] text-[var(--text-tertiary)]" for="harness-thinking">
          {{ $t('workspace.thinking') }}
        </label>
        <select
          id="harness-thinking"
          data-testid="harness-thinking-select"
          class="h-7 min-w-[130px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          :value="state.thinking.level"
          :disabled="harness.mutating || !state.capabilities.thinkingLevel"
          @change="changeThinking"
        >
          <option v-for="level in state.thinking.options" :key="level" :value="level">
            {{ level }}
          </option>
        </select>
        <button
          type="button"
          class="harness-danger-button ml-auto"
          :disabled="harness.mutating || !state.capabilities.abort"
          @click="safely(harness.abort())"
        >
          {{ $t('workspace.abort') }}
        </button>
      </div>
    </section>

    <section class="harness-card">
      <h3 class="harness-card-title">{{ $t('workspace.harnessQueue') }}</h3>
      <div class="mt-3 grid grid-cols-3 gap-2">
        <div class="harness-metric">
          <span>{{ $t('workspace.harnessPending') }}</span>
          <strong>{{ state.queue.pendingMessages }}</strong>
        </div>
        <div class="harness-metric">
          <span>{{ $t('workspace.harnessSteering') }}</span>
          <strong>{{ state.queue.steering.length }}</strong>
        </div>
        <div class="harness-metric">
          <span>{{ $t('workspace.harnessFollowUp') }}</span>
          <strong>{{ state.queue.followUp.length }}</strong>
        </div>
      </div>
      <div class="mt-3 grid gap-2 md:grid-cols-2">
        <form class="space-y-1.5" @submit.prevent="queueSteering">
          <textarea
            v-model="steeringMessage"
            class="harness-textarea"
            rows="2"
            :placeholder="$t('workspace.harnessSteeringPlaceholder')"
            :disabled="!state.capabilities.steering"
          />
          <button
            type="submit"
            class="harness-action-button"
            :disabled="harness.mutating || !state.capabilities.steering || !steeringMessage.trim()"
          >
            {{ $t('workspace.harnessQueueSteering') }}
          </button>
        </form>
        <form class="space-y-1.5" @submit.prevent="queueFollowUp">
          <textarea
            v-model="followUpMessage"
            class="harness-textarea"
            rows="2"
            :placeholder="$t('workspace.harnessFollowUpPlaceholder')"
            :disabled="!state.capabilities.followUp"
          />
          <button
            type="submit"
            class="harness-action-button"
            :disabled="harness.mutating || !state.capabilities.followUp || !followUpMessage.trim()"
          >
            {{ $t('workspace.harnessQueueFollowUp') }}
          </button>
        </form>
      </div>
      <div v-if="state.queue.steering.length || state.queue.followUp.length" class="mt-3 space-y-1">
        <p
          v-for="(message, index) in [...state.queue.steering, ...state.queue.followUp]"
          :key="`${index}:${message}`"
          class="truncate rounded bg-[var(--bg-surface)] px-2 py-1 font-mono text-[10.5px] text-[var(--text-secondary)]"
        >
          {{ message }}
        </p>
      </div>
    </section>
  </div>
</template>
