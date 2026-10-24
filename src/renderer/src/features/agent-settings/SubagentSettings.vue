<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Bot, Plus, Pencil, Play, Trash2 } from '@lucide/vue'
import { getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { useOrchestrationStore } from '@renderer/stores/orchestration'
import type { AgentTemplate } from '@shared/types/harness'
import type { ModelDefinition } from '@shared/ipc/api-types'
import Button from '@renderer/components/ui/Button.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import SettingsFeedback from './SettingsFeedback.vue'
import { useSettingsAction } from './useSettingsAction'
const { t } = useI18n(),
  router = useRouter(),
  orchestration = useOrchestrationStore()
const { busy, error, message, run } = useSettingsAction()
const templates = ref<AgentTemplate[]>([]),
  models = ref<ModelDefinition[]>([]),
  query = ref(''),
  open = ref(false),
  editId = ref<string>(),
  taskOpen = ref(false),
  root = ref(''),
  taskText = ref(''),
  taskTemplate = ref<AgentTemplate | null>(null)
const blank = () => ({
  name: '',
  role: 'assistant',
  description: '',
  systemPrompt: '',
  model: '',
  thinkingLevel: '',
  tools: '',
  workspaceMode: 'shared' as 'shared' | 'worktree',
  isReviewer: false,
  skillIds: [] as string[]
})
const form = ref(blank())
const entries = computed(() =>
  templates.value.filter((e) =>
    `${e.name} ${e.role} ${e.description}`.toLowerCase().includes(query.value.toLowerCase())
  )
)
const load = () =>
  run(async () => {
    templates.value = await getApi().orchestration.listTemplates()
    models.value = await getApi().models.list()
  })
function edit(item?: AgentTemplate) {
  editId.value = item?.id
  form.value = item
    ? {
        name: item.name,
        role: item.role,
        description: item.description ?? '',
        systemPrompt: item.systemPrompt ?? '',
        model: item.provider && item.modelId ? `${item.provider}::${item.modelId}` : '',
        thinkingLevel: item.thinkingLevel ?? '',
        tools: item.toolNames?.join(', ') ?? '',
        workspaceMode: item.workspaceMode,
        isReviewer: item.isReviewer,
        skillIds: [...item.skillIds]
      }
    : blank()
  open.value = true
}
async function save() {
  if (
    await run(async () => {
      const f = form.value,
        model = models.value.find((m) => `${m.providerId}::${m.modelId}` === f.model)
      await getApi().orchestration.saveTemplate({
        ...(editId.value ? { id: editId.value } : {}),
        name: f.name.trim(),
        role: f.role.trim(),
        description: f.description,
        systemPrompt: f.systemPrompt,
        provider: model?.providerId ?? null,
        modelId: model?.modelId ?? null,
        thinkingLevel: f.thinkingLevel || null,
        toolNames: f.tools.trim()
          ? f.tools
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
        skillIds: [...f.skillIds],
        workspaceMode: f.workspaceMode,
        isReviewer: f.isReviewer
      })
      templates.value = await getApi().orchestration.listTemplates()
    }, true)
  )
    open.value = false
}
async function remove(item: AgentTemplate) {
  if (
    !(await askConfirm({
      title: t('agentSettings.deleteTitle'),
      description: item.name,
      confirmLabel: t('agentSettings.remove')
    }))
  )
    return
  await run(async () => {
    await getApi().orchestration.deleteTemplate(item.id)
    templates.value = await getApi().orchestration.listTemplates()
  })
}
function openTask(item: AgentTemplate) {
  taskTemplate.value = item
  taskText.value = ''
  taskOpen.value = true
}
async function chooseRoot() {
  await run(async () => {
    const selected = await getApi().workspace.pickDirectory()
    if (selected) root.value = selected
  })
}
async function startTask() {
  if (
    await run(async () => {
      const template = taskTemplate.value!
      const created = await getApi().orchestration.create({
        name: `${template.name}: ${taskText.value.slice(0, 60)}`,
        cwd: root.value,
        templateIds: [template.id],
        strategy: 'sequential',
        maxConcurrentAgents: 1,
        maxConcurrentRuns: 1
      })
      const agents = await getApi().orchestration.listAgents(created.id)
      await getApi().orchestration.createTask({
        orchestrationId: created.id,
        title: taskText.value.slice(0, 120),
        description: taskText.value,
        assignedAgentId: agents[0]?.id
      })
      await getApi().orchestration.start(created.id)
      orchestration.currentId = created.id
      await orchestration.refreshList()
      await orchestration.select(created.id)
      message.value = t('agentSettings.taskStarted')
    })
  )
    taskOpen.value = false
}
onMounted(load)
</script>
<template>
  <div class="feature-stack">
    <div class="feature-actions">
      <input
        v-model="query"
        class="feature-input max-w-xs"
        :aria-label="t('agentSettings.searchItems')"
        :placeholder="t('agentSettings.searchItems')"
      /><Button variant="primary" :disabled="busy" @click="edit()"
        ><Plus class="size-3.5" />{{ t('agentSettings.newSubagent') }}</Button
      ><Button :disabled="busy" @click="load">{{ t('agentSettings.reload') }}</Button>
    </div>
    <SettingsFeedback :busy="busy" :error="error" :message="message" />
    <div
      v-for="item in entries"
      :key="item.id"
      class="feature-card"
      :data-testid="`subagent-${item.name}`"
    >
      <div class="flex items-start gap-4">
        <Bot class="size-6 shrink-0 text-[var(--text-tertiary)]" :stroke-width="1.5" />
        <div class="min-w-0 flex-1">
          <h2 class="!mb-1">{{ item.name }}</h2>
          <p class="feature-hint">{{ item.description || item.role }}</p>
          <p class="feature-hint mt-2">
            {{ item.modelId || t('agentSettings.inheritModel') }} ·
            {{
              t(
                item.workspaceMode === 'worktree'
                  ? 'agentSettings.isolatedWorkspace'
                  : 'agentSettings.sharedWorkspace'
              )
            }}
          </p>
        </div>
        <div class="feature-actions">
          <Button
            size="sm"
            :disabled="busy"
            :aria-label="`${t('agentSettings.runTask')} ${item.name}`"
            @click="openTask(item)"
            ><Play class="size-3.5" /></Button
          ><Button
            size="sm"
            :disabled="busy"
            :aria-label="`${t('agentSettings.edit')} ${item.name}`"
            @click="edit(item)"
            ><Pencil class="size-3.5" /></Button
          ><Button
            size="sm"
            :disabled="busy"
            :aria-label="`${t('agentSettings.remove')} ${item.name}`"
            @click="remove(item)"
            ><Trash2 class="size-3.5"
          /></Button>
        </div>
      </div>
    </div>
    <div v-if="!busy && !entries.length" class="feature-empty">
      <Bot class="mx-auto mb-3 size-8 opacity-50" />{{ t('agentSettings.empty') }}
    </div>
    <div>
      <Button @click="router.push('/workspace?tool=orchestration')">{{
        t('agentSettings.openWorkspace')
      }}</Button>
    </div>
    <Dialog
      v-model:open="open"
      :title="t(editId ? 'agentSettings.editSubagent' : 'agentSettings.newSubagent')"
      large
      ><div class="agent-settings">
        <form class="feature-stack" @submit.prevent="save">
          <fieldset :disabled="busy" class="feature-stack">
            <div class="feature-grid">
              <label class="feature-field"
                >{{ t('agentSettings.name')
                }}<input
                  v-model="form.name"
                  class="feature-input"
                  maxlength="120"
                  required /></label
              ><label class="feature-field"
                >{{ t('agentSettings.role')
                }}<input v-model="form.role" class="feature-input" maxlength="60" required
              /></label>
            </div>
            <label class="feature-field"
              >{{ t('agentSettings.description')
              }}<input v-model="form.description" class="feature-input" maxlength="2000"
            /></label>
            <label class="feature-field"
              >{{ t('agentSettings.systemPrompt')
              }}<textarea
                v-model="form.systemPrompt"
                class="feature-textarea min-h-[160px]"
                maxlength="20000"
              />
            </label>
            <div class="feature-grid">
              <label class="feature-field"
                >{{ t('agentSettings.model')
                }}<select v-model="form.model" class="feature-input">
                  <option value="">{{ t('agentSettings.inheritModel') }}</option>
                  <option
                    v-for="model in models"
                    :key="model.id"
                    :value="`${model.providerId}::${model.modelId}`"
                  >
                    {{ model.displayName || model.modelId }} · {{ model.providerId }}
                  </option>
                </select></label
              ><label class="feature-field"
                >{{ t('agentSettings.thinkingLevel')
                }}<select v-model="form.thinkingLevel" class="feature-input">
                  <option value="">{{ t('agentSettings.inheritModel') }}</option>
                  <option
                    v-for="level in ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']"
                    :key="level"
                    :value="level"
                  >
                    {{ t(`agentSettings.${level}`) }}
                  </option>
                </select></label
              >
            </div>
            <label class="feature-field"
              >{{ t('agentSettings.tools')
              }}<input
                v-model="form.tools"
                class="feature-input"
                placeholder="read, grep, find, ls"
            /></label>
            <label class="feature-field"
              >{{ t('agentSettings.workspaceMode')
              }}<select v-model="form.workspaceMode" class="feature-input">
                <option value="shared">{{ t('agentSettings.sharedWorkspace') }}</option>
                <option value="worktree">{{ t('agentSettings.isolatedWorkspace') }}</option>
              </select></label
            >
            <div class="feature-row">
              <span>{{ t('agentSettings.reviewer') }}</span
              ><Switch v-model="form.isReviewer" :label="t('agentSettings.reviewer')" />
            </div>
          </fieldset>
          <SettingsFeedback :error="error" />
          <div class="feature-actions justify-end">
            <Button :disabled="busy" @click="open = false">{{ t('agentSettings.cancel') }}</Button
            ><Button type="submit" variant="primary" :disabled="busy">{{
              t('agentSettings.save')
            }}</Button>
          </div>
        </form>
      </div></Dialog
    >
    <Dialog
      v-model:open="taskOpen"
      :title="`${t('agentSettings.runTask')} · ${taskTemplate?.name}`"
      large
      ><div class="agent-settings">
        <form class="feature-stack" @submit.prevent="startTask">
          <div class="feature-actions">
            <Button :disabled="busy" @click="chooseRoot">{{
              t('agentSettings.chooseProject')
            }}</Button
            ><span class="feature-hint break-all">{{ root }}</span>
          </div>
          <label class="feature-field"
            >{{ t('agentSettings.task')
            }}<textarea
              v-model="taskText"
              class="feature-textarea min-h-[180px]"
              required
              maxlength="20000"
            /></label
          ><SettingsFeedback :error="error" />
          <div class="feature-actions justify-end">
            <Button type="submit" variant="primary" :disabled="busy || !root || !taskText.trim()">{{
              t('agentSettings.startTask')
            }}</Button>
          </div>
        </form>
      </div></Dialog
    >
  </div>
</template>
