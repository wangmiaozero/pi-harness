<script setup lang="ts">
import type { HarnessState, HarnessTool } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'

const props = defineProps<{ state: HarnessState }>()
const harness = useHarnessStore()

async function toggle(tool: HarnessTool) {
  const active = props.state.tools
    .filter((candidate) => (candidate.name === tool.name ? !tool.active : candidate.active))
    .map((candidate) => candidate.name)
  try {
    await harness.setTools(active)
  } catch {
    /* Store exposes the sanitized error. */
  }
}
</script>

<template>
  <section class="harness-card max-w-4xl">
    <div class="flex items-center justify-between">
      <h3 class="harness-card-title">{{ $t('workspace.harnessToolsInspector') }}</h3>
      <span class="text-[11px] text-[var(--text-tertiary)]">
        {{ state.tools.filter((tool) => tool.active).length }} / {{ state.tools.length }}
      </span>
    </div>
    <div v-if="state.tools.length" class="mt-3 divide-y divide-[var(--border-subtle)]">
      <div v-for="tool in state.tools" :key="tool.name" class="flex items-center gap-3 py-2.5">
        <button
          type="button"
          role="switch"
          class="h-6 min-w-[68px] rounded-full border px-2 text-[10.5px] font-medium"
          :class="
            tool.active
              ? 'border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]'
              : 'border-[var(--border-default)] text-[var(--text-tertiary)]'
          "
          :aria-checked="tool.active"
          :aria-label="`${tool.name}: ${tool.active ? 'enabled' : 'disabled'}`"
          :disabled="harness.mutating || !state.capabilities.tools"
          @click="toggle(tool)"
        >
          {{ tool.active ? $t('common.enabled') : $t('common.disabled') }}
        </button>
        <div class="min-w-0">
          <p class="font-mono text-[12px] text-[var(--text-primary)]">{{ tool.name }}</p>
          <p class="truncate text-[10.5px] text-[var(--text-tertiary)]">
            {{ tool.description }}
          </p>
        </div>
      </div>
    </div>
    <p v-else class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessToolsUnavailable') }}
    </p>
  </section>
</template>
