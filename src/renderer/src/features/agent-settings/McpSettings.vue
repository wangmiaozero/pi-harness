<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Server, Pencil, Trash2, Download, Store, FolderOpen } from '@lucide/vue'
import { getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import type { McpEntry, McpInput, McpInventory } from '@shared/agent-settings/schema'
import { mcpSaveSchema } from '@shared/agent-settings/schema'
import Button from '@renderer/components/ui/Button.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import McpMarket from './McpMarket.vue'
import McpScanner from './McpScanner.vue'
import type { McpScanCandidate } from '@shared/agent-settings/schema'
import { projectDisplayName } from '@shared/workspace/session-tree'
import { useSessionStore } from '@renderer/stores/sessions'
import SettingsFeedback from './SettingsFeedback.vue'
import { useSettingsAction } from './useSettingsAction'
const { t } = useI18n()
const { busy, error, message, run } = useSettingsAction()
const marketOpen = ref(false),
  scanOpen = ref(false)
const sessions = useSessionStore()
const projectRoot = ref<string | undefined>(
  sessions.current?.projectRoot || sessions.current?.cwd || sessions.currentProject?.projectRoot
)
const scopeFilter = ref<'all' | 'global' | 'project'>('all')
const globalInventory = ref<McpInventory | null>(null),
  projectInventory = ref<McpInventory | null>(null)
const root = ref<string>(),
  query = ref(''),
  open = ref(false),
  editing = ref(false),
  formError = ref('')
const blank = () => ({
  id: '',
  type: 'stdio' as 'stdio' | 'http',
  command: '',
  args: '',
  url: '',
  description: '',
  enabled: true,
  exposure: 'codemode' as McpEntry['exposure'],
  env: '{}',
  headers: '{}'
})
const form = ref(blank())
const inventory = computed({
  get: () => (root.value ? projectInventory.value : globalInventory.value),
  set: (value) => {
    if (root.value) projectInventory.value = value
    else globalInventory.value = value
  }
})
const counts = computed(() => ({
  global: globalInventory.value?.entries.length ?? 0,
  project: projectInventory.value?.entries.length ?? 0,
  all: (globalInventory.value?.entries.length ?? 0) + (projectInventory.value?.entries.length ?? 0)
}))
const groups = computed(() =>
  [
    { scope: 'global' as const, root: undefined, inventory: globalInventory.value },
    ...(projectRoot.value
      ? [{ scope: 'project' as const, root: projectRoot.value, inventory: projectInventory.value }]
      : [])
  ]
    .filter((group) => scopeFilter.value === 'all' || scopeFilter.value === group.scope)
    .map((group) => ({
      ...group,
      entries:
        group.inventory?.entries.filter((entry) =>
          `${entry.id} ${entry.description}`.toLowerCase().includes(query.value.toLowerCase())
        ) ?? []
    }))
)
const projects = computed(() => [
  ...new Set([
    ...(projectRoot.value ? [projectRoot.value] : []),
    ...sessions.projects.map((project) => project.projectRoot)
  ])
])
const scopeLocked = computed(() => busy.value || open.value || marketOpen.value || scanOpen.value)
const canAdd = computed(
  () =>
    Boolean(globalInventory.value) &&
    (scopeFilter.value !== 'project' || Boolean(projectRoot.value && projectInventory.value))
)
const load = () =>
  run(async () => {
    const selectedRoot = projectRoot.value
    const [global, project] = await Promise.allSettled([
      getApi().agentSettings.mcp.list({}),
      selectedRoot ? getApi().agentSettings.mcp.list({ root: selectedRoot }) : Promise.resolve(null)
    ])
    if (global.status === 'fulfilled') globalInventory.value = global.value
    if (project.status === 'fulfilled' && selectedRoot === projectRoot.value)
      projectInventory.value = project.value
    if (global.status === 'rejected') throw global.reason
    if (project.status === 'rejected') throw project.reason
  })
function defaultRoot() {
  return scopeFilter.value === 'project' ? projectRoot.value : undefined
}
function openMarket() {
  root.value = defaultRoot()
  marketOpen.value = true
}
function openScan() {
  root.value = defaultRoot()
  scanOpen.value = true
}
async function chooseProject() {
  let selected: string | null = null
  await run(async () => {
    selected = await getApi().workspace.pickDirectory()
  })
  if (selected) projectRoot.value = selected
}
function importCandidate(candidate: McpScanCandidate) {
  scanOpen.value = false
  const template = candidate.template
  editing.value = false
  form.value = {
    ...blank(),
    ...template,
    command: template.command ?? '',
    url: template.url ?? '',
    description: template.description ?? '',
    args: template.args?.join('\n') ?? '',
    env: JSON.stringify(template.env ?? {}, null, 2),
    headers: JSON.stringify(template.headers ?? {}, null, 2),
    enabled: false
  }
  formError.value = candidate.blocked ? t('mcpMarket.credentialsHint') : ''
  open.value = true
}
function edit(entry?: McpEntry, entryRoot?: string) {
  root.value = entry ? entryRoot : defaultRoot()
  formError.value = ''
  editing.value = Boolean(entry)
  form.value = entry
    ? {
        ...entry,
        args: entry.args.join('\n'),
        env: JSON.stringify(entry.env, null, 2),
        headers: JSON.stringify(entry.headers, null, 2)
      }
    : blank()
  open.value = true
}
async function save() {
  formError.value = ''
  let input: McpInput
  try {
    const f = form.value
    if (
      !editing.value &&
      (JSON.stringify(f).includes('[redacted]') || JSON.stringify(f).includes('••••'))
    ) {
      formError.value = t('mcpMarket.credentialsHint')
      return
    }
    input = mcpSaveSchema.parse({
      ...(root.value ? { root: root.value } : {}),
      id: f.id,
      revision: inventory.value!.revision,
      type: f.type,
      description: f.description,
      enabled: f.enabled,
      exposure: f.exposure,
      ...(f.type === 'stdio'
        ? { command: f.command, args: f.args ? f.args.split('\n') : [], env: JSON.parse(f.env) }
        : { url: f.url, headers: JSON.parse(f.headers) })
    })
    if (!editing.value && inventory.value?.entries.some((e) => e.id === input.id)) {
      formError.value = t('agentSettings.duplicateName')
      return
    }
  } catch {
    formError.value = t('agentSettings.referencesHint', { example: '${MY_TOKEN}' })
    return
  }
  if (
    await run(async () => {
      inventory.value = await getApi().agentSettings.mcp.save(input)
    }, true)
  )
    open.value = false
}
async function toggle(entry: McpEntry, enabled: boolean, entryRoot?: string) {
  root.value = entryRoot
  await run(async () => {
    inventory.value = await getApi().agentSettings.mcp.toggle({
      ...(root.value ? { root: root.value } : {}),
      id: entry.id,
      revision: inventory.value!.revision,
      enabled
    })
  })
}
async function remove(entry: McpEntry, entryRoot?: string) {
  root.value = entryRoot
  if (
    !(await askConfirm({
      title: t('agentSettings.deleteTitle'),
      description: `${entry.id} — ${t('agentSettings.deleteHint')}`,
      confirmLabel: t('agentSettings.remove'),
      tone: 'danger'
    }))
  )
    return
  await run(async () => {
    inventory.value = await getApi().agentSettings.mcp.remove({
      ...(root.value ? { root: root.value } : {}),
      id: entry.id,
      revision: inventory.value!.revision
    })
  })
}
watch(projectRoot, () => {
  projectInventory.value = null
  if (root.value) root.value = projectRoot.value
  void load()
})
onMounted(load)
</script>
<template>
  <McpMarket
    v-if="marketOpen && inventory"
    :root="root"
    :inventory="inventory"
    @back="marketOpen = false"
    @installed="inventory = $event"
  />
  <div v-else class="feature-stack">
    <div class="feature-actions">
      <div
        class="flex gap-1 rounded-xl bg-[var(--bg-hover)] p-1"
        role="group"
        :aria-label="t('agentSettings.scope')"
      >
        <Button
          v-for="scope in ['all', 'global', 'project'] as const"
          :key="scope"
          size="sm"
          :variant="scopeFilter === scope ? 'primary' : 'ghost'"
          :aria-pressed="scopeFilter === scope"
          :disabled="scopeLocked"
          @click="scopeFilter = scope"
          >{{ t(`agentSettings.${scope}`) }}
          <span class="ml-1 text-xs opacity-70">{{ counts[scope] }}</span></Button
        >
      </div>
      <select
        v-if="projects.length"
        v-model="projectRoot"
        class="feature-input !w-auto max-w-xs"
        :aria-label="t('agentSettings.chooseProject')"
        :title="projectRoot"
        :disabled="scopeLocked"
      >
        <option v-for="project in projects" :key="project" :value="project">
          {{ projectDisplayName(project) }}
        </option>
      </select>
      <Button :disabled="scopeLocked" @click="chooseProject"
        ><FolderOpen class="size-3.5" />{{ t('agentSettings.chooseProject') }}</Button
      >
    </div>
    <div class="feature-actions">
      <Button :disabled="busy || !canAdd" @click="openScan"
        ><Download class="size-3.5" />{{ t('mcpMarket.scan') }}</Button
      ><Button :disabled="busy || !canAdd" @click="openMarket"
        ><Store class="size-3.5" />{{ t('mcpMarket.market') }}</Button
      >
      <input
        v-model="query"
        class="feature-input max-w-xs"
        :placeholder="t('agentSettings.searchItems')"
        :aria-label="t('agentSettings.searchItems')"
      /><Button variant="primary" :disabled="busy || !canAdd" @click="edit()"
        ><Plus class="size-3.5" />{{ t('agentSettings.newServer') }}</Button
      ><Button :disabled="busy" @click="load">{{ t('agentSettings.reload') }}</Button>
    </div>
    <SettingsFeedback :busy="busy" :error="error" :message="message" />
    <section
      v-for="group in groups"
      :key="group.scope"
      class="feature-stack"
      :data-testid="`mcp-scope-${group.scope}`"
    >
      <div class="flex items-center justify-between gap-3">
        <p class="feature-hint min-w-0 break-all">
          <strong class="mr-2">{{ t(`agentSettings.${group.scope}`) }}</strong
          ><span class="font-mono">{{ group.inventory?.path }}</span>
        </p>
        <span
          class="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-xs text-[var(--text-tertiary)]"
          >{{ group.inventory?.entries.length ?? 0 }}</span
        >
      </div>
      <div
        v-for="entry in group.entries"
        :key="entry.id"
        class="feature-card flex items-center gap-4"
        :data-testid="`mcp-server-${entry.id}`"
      >
        <Server class="size-6 shrink-0 text-[var(--text-tertiary)]" :stroke-width="1.5" />
        <div class="min-w-0 flex-1">
          <h2 class="!mb-1">{{ entry.id }}</h2>
          <p class="feature-hint truncate">
            {{ entry.description || (entry.type === 'http' ? entry.url : entry.command) }}
          </p>
          <p class="feature-hint">
            {{ t(`agentSettings.${entry.type}`) }} · {{ t(`agentSettings.${entry.exposure}`) }}
          </p>
        </div>
        <div class="feature-actions">
          <Switch
            :model-value="entry.enabled"
            :label="`${t('agentSettings.enabled')} ${entry.id}`"
            :disabled="busy"
            @update:model-value="toggle(entry, $event, group.root)"
          /><Button
            size="sm"
            :disabled="busy"
            :aria-label="`${t('agentSettings.edit')} ${entry.id}`"
            @click="edit(entry, group.root)"
            ><Pencil class="size-3.5" /></Button
          ><Button
            size="sm"
            :disabled="busy"
            :aria-label="`${t('agentSettings.remove')} ${entry.id}`"
            @click="remove(entry, group.root)"
            ><Trash2 class="size-3.5"
          /></Button>
        </div>
      </div>
      <div v-if="group.inventory && !group.entries.length" class="feature-empty">
        <Server class="mx-auto mb-3 size-8 opacity-50" />
        <p>{{ t(query ? 'mcpMarket.noServerResults' : 'mcpMarket.emptyServers') }}</p>
      </div>
    </section>
    <p v-if="scopeFilter === 'project' && !projectRoot" class="feature-empty">
      {{ t('mcpMarket.chooseProjectHint') }}
    </p>
    <p class="feature-hint">{{ t('agentSettings.newSessionHint') }}</p>
    <McpScanner
      v-if="scanOpen"
      :root="root"
      :scan-root="projectRoot"
      :inventory="inventory"
      @close="scanOpen = false"
      @import="importCandidate"
    />
    <Dialog
      v-model:open="open"
      :title="t(editing ? 'agentSettings.editServer' : 'agentSettings.newServer')"
      large
    >
      <div class="agent-settings">
        <form class="feature-stack" @submit.prevent="save">
          <fieldset :disabled="busy" class="feature-stack">
            <label class="feature-field"
              >{{ t('agentSettings.scope')
              }}<select v-model="root" class="feature-input" :disabled="editing">
                <option :value="undefined">{{ t('agentSettings.global') }}</option>
                <option v-if="projectRoot" :value="projectRoot" :disabled="!projectInventory">
                  {{ t('agentSettings.project') }} · {{ projectRoot }}
                </option>
              </select></label
            >
            <div class="feature-grid">
              <label class="feature-field"
                >{{ t('agentSettings.name')
                }}<input
                  v-model="form.id"
                  class="feature-input"
                  :disabled="editing"
                  required
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}" /></label
              ><label class="feature-field"
                >{{ t('agentSettings.transport')
                }}<select v-model="form.type" class="feature-input">
                  <option value="stdio">{{ t('agentSettings.stdio') }}</option>
                  <option value="http">HTTP</option>
                </select></label
              >
            </div>
            <label class="feature-field"
              >{{ t('agentSettings.description')
              }}<input v-model="form.description" class="feature-input" maxlength="2000"
            /></label>
            <template v-if="form.type === 'stdio'"
              ><label class="feature-field"
                >{{ t('agentSettings.command')
                }}<input
                  v-model="form.command"
                  class="feature-input"
                  required
                  placeholder="npx" /></label
              ><label class="feature-field"
                >{{ t('agentSettings.arguments')
                }}<textarea
                  v-model="form.args"
                  class="feature-textarea"
                  placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/your/project"
                /></label
              ><label class="feature-field"
                >{{ t('agentSettings.env')
                }}<textarea v-model="form.env" class="feature-textarea" /></label
            ></template>
            <template v-else
              ><label class="feature-field"
                >{{ t('agentSettings.url')
                }}<input
                  v-model="form.url"
                  class="feature-input"
                  required
                  type="url"
                  placeholder="https://example.com/mcp" /></label
              ><label class="feature-field"
                >{{ t('agentSettings.headers')
                }}<textarea v-model="form.headers" class="feature-textarea" /></label
            ></template>
            <label class="feature-field"
              >{{ t('agentSettings.exposure')
              }}<select v-model="form.exposure" class="feature-input">
                <option
                  v-for="exposure in ['codemode', 'deferred', 'direct', 'hidden']"
                  :key="exposure"
                  :value="exposure"
                >
                  {{ t(`agentSettings.${exposure}`) }}
                </option>
              </select></label
            >
            <p class="feature-hint">
              {{ t('agentSettings.referencesHint', { example: '${MY_TOKEN}' }) }}
            </p>
            <p v-if="editing" class="feature-hint">{{ t('agentSettings.protectedHint') }}</p>
          </fieldset>
          <p v-if="formError || error" role="alert" class="feature-error">
            {{ formError || error }}
          </p>
          <div class="feature-actions justify-end">
            <Button :disabled="busy" @click="open = false">{{ t('agentSettings.cancel') }}</Button
            ><Button variant="primary" type="submit" :disabled="busy">{{
              t('agentSettings.save')
            }}</Button>
          </div>
        </form>
      </div>
    </Dialog>
  </div>
</template>
