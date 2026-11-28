<script setup lang="ts">
import { startupChecks } from '@renderer/startup'

defineProps<{ status: string; layout: 'themed' | 'brief' | 'waiting' }>()
</script>

<template>
  <div class="startup-animation__content" :class="`startup-animation__content--${layout}`">
    <p v-if="layout === 'themed'" class="startup-animation__eyebrow">PI-HARNESS / SYSTEM INIT</p>
    <p class="startup-animation__status" :role="layout === 'brief' ? 'status' : undefined">
      <span v-if="layout !== 'waiting'" class="startup-animation__pulse" aria-hidden="true" />
      {{ status }}
    </p>
    <div v-if="layout === 'themed'" class="startup-animation__rule" aria-hidden="true">
      <span />
    </div>
    <dl class="startup-animation__checks">
      <div
        v-for="(check, id) in startupChecks"
        :key="id"
        class="startup-animation__check"
        :data-testid="`startup-check-${id}`"
      >
        <dt>
          {{
            {
              node: 'Node.js',
              npm: 'npm',
              pi: 'Pi Agent',
              config: '配置文件'
            }[id]
          }}
        </dt>
        <dd :class="`startup-animation__result--${check.state}`">
          <span class="startup-animation__indicator" />{{ check.detail }}
        </dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.startup-animation__content {
  position: absolute;
  top: 62%;
  left: 50%;
  width: min(340px, 70vw);
  transform: translateX(-50%);
  text-align: center;
}
.startup-animation__eyebrow {
  margin: 0 0 13px;
  color: color-mix(in srgb, var(--startup-text) 37%, transparent);
  font:
    10px/1.4 ui-monospace,
    SFMono-Regular,
    monospace;
  letter-spacing: 0.25em;
}
.startup-animation__status {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 9px;
  margin: 0;
  color: color-mix(in srgb, var(--startup-text) 72%, transparent);
  font-size: 12px;
  letter-spacing: 0.08em;
}
.startup-animation__pulse {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--startup-accent);
  box-shadow: 0 0 12px var(--startup-accent);
  animation: pulse 1.3s ease-in-out infinite;
}
.startup-animation__rule {
  height: 1px;
  margin-top: 23px;
  background: color-mix(in srgb, var(--startup-text) 12%, transparent);
  overflow: hidden;
}
.startup-animation__rule span {
  display: block;
  width: 35%;
  height: 100%;
  background: linear-gradient(90deg, transparent, var(--startup-accent), transparent);
  animation: scan 1.7s ease-in-out infinite;
}
.startup-animation__checks {
  margin: 14px 0 0;
  padding: 0;
}
.startup-animation__check {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 26px;
  color: color-mix(in srgb, var(--startup-text) 48%, transparent);
  font:
    11px/1.4 ui-monospace,
    SFMono-Regular,
    monospace;
  letter-spacing: 0.03em;
}
.startup-animation__check dt,
.startup-animation__check dd {
  margin: 0;
}
.startup-animation__check dd {
  display: flex;
  align-items: center;
  gap: 8px;
  color: color-mix(in srgb, var(--startup-text) 64%, transparent);
}
.startup-animation__indicator {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #68727f;
}
.startup-animation__result--healthy .startup-animation__indicator {
  background: var(--startup-accent);
  box-shadow: 0 0 8px var(--startup-accent);
}
.startup-animation__result--warning .startup-animation__indicator {
  background: #f87915;
}
.startup-animation__result--error .startup-animation__indicator {
  background: #f06565;
}
@keyframes pulse {
  50% {
    opacity: 0.25;
    transform: scale(0.65);
  }
}
@keyframes scan {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(380%);
  }
}

.startup-animation__content--brief,
.startup-animation__content--waiting {
  --startup-text: #e8e0fc;
  --startup-accent: #b499ff;
  width: min(344px, calc(100% - 48px));
}
.startup-animation__content--brief {
  top: auto;
  bottom: clamp(20px, 6.5vh, 65px);
}
.startup-animation__content--waiting {
  top: 50%;
  transform: translate(-50%, -50%);
}
.startup-animation__content--brief .startup-animation__status,
.startup-animation__content--waiting .startup-animation__status {
  color: #d6cbea;
  font-size: 13px;
  letter-spacing: 0.025em;
}
.startup-animation__content--brief .startup-animation__checks,
.startup-animation__content--waiting .startup-animation__checks {
  margin-top: 15px;
  border-top: 1px solid #a888ec33;
  padding-top: 9px;
}
.startup-animation__content--brief .startup-animation__check,
.startup-animation__content--waiting .startup-animation__check {
  min-height: 24px;
  color: #9e92b9;
}
.startup-animation__content--brief .startup-animation__check dd,
.startup-animation__content--waiting .startup-animation__check dd {
  color: #c6b9df;
}
@media (prefers-reduced-motion: reduce) {
  .startup-animation__pulse,
  .startup-animation__rule span {
    animation: none;
  }
}
</style>
