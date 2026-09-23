<script setup lang="ts">
/**
 * Pi runtime supervisor status banner (Tauri only).
 *
 * Crash recovery UI (migration plan §29): when the Node sidecar dies the
 * renderer keeps running and shows this banner with a Restart action, so a
 * runtime crash never white-screens the app. The banner only mounts its
 * logic when the platform exposes the runtime API (`getRuntimeApi()` returns
 * null on Electron — no sidecar there), keeping all host detection inside
 * `src/platform/` (§25).
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getRuntimeApi, type RuntimePhase } from '@platform'

const { t } = useI18n()

const runtimeApi = getRuntimeApi()
const phase = ref<RuntimePhase | null>(null)
const restarting = ref(false)
const dismissed = ref(false)

const visible = computed(() => {
  if (!runtimeApi || dismissed.value) return false
  if (phase.value === 'crashed' || phase.value === 'failed') return true
  // A starting hint is only interesting once we know the app wanted the
  // runtime (it lazy-starts with the first domain request).
  return phase.value === 'starting'
})

const tone = computed(() =>
  phase.value === 'crashed' || phase.value === 'failed' ? 'danger' : 'info'
)
const label = computed(() => {
  if (restarting.value) return t('runtimeStatus.restarting')
  if (phase.value === 'crashed' || phase.value === 'failed') return t('runtimeStatus.crashed')
  return t('runtimeStatus.starting')
})

let unsubscribe: (() => void) | null = null

async function restart(): Promise<void> {
  if (!runtimeApi || restarting.value) return
  restarting.value = true
  try {
    const status = await runtimeApi.restart()
    phase.value = status.phase
    if (status.phase === 'running' || status.phase === 'ready') dismissed.value = true
  } catch {
    // Restart failed; keep the banner so the user can retry.
    phase.value = 'crashed'
  } finally {
    restarting.value = false
  }
}

onMounted(() => {
  if (!runtimeApi) return
  unsubscribe = runtimeApi.onState((payload) => {
    phase.value = payload.phase
    if (payload.phase === 'running' || payload.phase === 'ready' || payload.phase === 'stopped') {
      dismissed.value = false
    }
  })
  void runtimeApi
    .status()
    .then((status) => {
      phase.value = status.phase
    })
    .catch(() => {
      // Supervisor unreachable — the banner stays hidden.
    })
})

onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<template>
  <Transition name="runtime-banner">
    <div
      v-if="visible"
      class="runtime-status-banner"
      :class="`runtime-status-banner--${tone}`"
      role="status"
    >
      <span class="runtime-status-banner__dot" aria-hidden="true" />
      <span class="runtime-status-banner__label">{{ label }}</span>
      <button
        v-if="phase === 'crashed' || phase === 'failed'"
        type="button"
        class="runtime-status-banner__action"
        :disabled="restarting"
        @click="restart()"
      >
        {{ t('runtimeStatus.restart') }}
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.runtime-status-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1200;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 12px;
  border: 1px solid var(--border-primary, rgba(255, 255, 255, 0.12));
  background: var(--bg-secondary, rgba(20, 22, 28, 0.92));
  color: var(--text-primary, #e8eaf0);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
}

.runtime-status-banner--info .runtime-status-banner__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4c9ffe;
  animation: runtime-banner-pulse 1.2s ease-in-out infinite;
}

.runtime-status-banner--danger {
  border-color: rgba(255, 105, 97, 0.45);
}

.runtime-status-banner--danger .runtime-status-banner__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff6961;
}

.runtime-status-banner__label {
  white-space: nowrap;
}

.runtime-status-banner__action {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  border-radius: 7px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.runtime-status-banner__action:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
}

.runtime-status-banner__action:disabled {
  opacity: 0.6;
  cursor: default;
}

.runtime-banner-enter-active,
.runtime-banner-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.runtime-banner-enter-from,
.runtime-banner-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}

@keyframes runtime-banner-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
