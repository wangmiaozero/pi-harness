<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from '@renderer/components/common/PageHeader.vue'
const props = defineProps<{
  section: 'ai' | 'voice' | 'shortcuts' | 'instructions' | 'mcp' | 'subagents' | 'remote'
}>()
const { t } = useI18n()
const views = {
  ai: defineAsyncComponent(() => import('@renderer/features/agent-settings/AiSettings.vue')),
  voice: defineAsyncComponent(() => import('@renderer/features/agent-settings/VoiceSettings.vue')),
  shortcuts: defineAsyncComponent(
    () => import('@renderer/features/agent-settings/ShortcutSettings.vue')
  ),
  instructions: defineAsyncComponent(
    () => import('@renderer/features/agent-settings/InstructionSettings.vue')
  ),
  mcp: defineAsyncComponent(() => import('@renderer/features/agent-settings/McpSettings.vue')),
  subagents: defineAsyncComponent(
    () => import('@renderer/features/agent-settings/SubagentSettings.vue')
  ),
  remote: defineAsyncComponent(() => import('@renderer/features/agent-settings/RemoteSettings.vue'))
}
const view = computed(() => views[props.section])
</script>
<template>
  <div
    class="agent-settings flex h-full min-h-0 flex-col"
    :data-testid="`agent-settings-${section}`"
  >
    <PageHeader
      ><div>
        <h1 class="text-[15px] font-semibold">{{ t(`agentSettings.${section}`) }}</h1>
        <p class="mt-1 text-xs text-[var(--text-tertiary)]">
          {{ t(`agentSettings.${section}Hint`) }}
        </p>
      </div></PageHeader
    >
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-[1080px] p-6"><component :is="view" :key="section" /></div>
    </div>
  </div>
</template>
<style>
.agent-settings {
  color: var(--text-primary);
}
.agent-settings .feature-stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.agent-settings .feature-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  padding: 20px;
}
.agent-settings .feature-card h2 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}
.agent-settings .feature-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 13px 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
}
.agent-settings .feature-row:last-child {
  border-bottom: 0;
}
.agent-settings .feature-hint {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.7;
}
.agent-settings .feature-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.agent-settings .feature-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
  color: var(--text-secondary);
}
.agent-settings .feature-input,
.agent-settings .feature-textarea {
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--control-bg);
  color: var(--text-primary);
  padding: 9px 11px;
  font-size: 13px;
  width: 100%;
}
.agent-settings .feature-input:focus,
.agent-settings .feature-textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
.agent-settings .feature-textarea {
  resize: vertical;
  line-height: 1.65;
  min-height: 100px;
  font-family: var(--font-mono);
}
.agent-settings .feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.agent-settings .feature-empty {
  padding: 48px 20px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-lg);
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
}
.agent-settings .feature-error {
  color: var(--error);
  font-size: 12px;
  white-space: pre-wrap;
}
.agent-settings .feature-success {
  color: var(--success);
  font-size: 12px;
}
@media (max-width: 1050px) {
  .agent-settings .feature-grid {
    grid-template-columns: 1fr;
  }
}
</style>
