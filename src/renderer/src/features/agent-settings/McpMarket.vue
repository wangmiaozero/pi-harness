<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft,
  Server,
  Search,
  Download,
  FolderOpen,
  Globe,
  Code,
  BookOpen,
  Database,
  ListChecks
} from '@lucide/vue'
import { MCP_CATALOG, type McpCatalogEntry } from '@shared/capabilities/mcp-catalog'
import type { McpInventory } from '@shared/agent-settings/schema'
import { getApi } from '@renderer/composables/useApi'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import SettingsFeedback from './SettingsFeedback.vue'
const props = defineProps<{ root?: string; inventory: McpInventory }>()
const emit = defineEmits<{ back: []; installed: [inventory: McpInventory] }>()
const { t, locale } = useI18n()
const query = ref(''),
  category = ref('all'),
  entries = ref<McpCatalogEntry[]>([...MCP_CATALOG]),
  remoteBusy = ref(false),
  busy = ref(false),
  error = ref(''),
  offline = ref(false),
  nextCursor = ref<string>(),
  selected = ref<McpCatalogEntry | null>(null),
  open = ref(false),
  folder = ref<string>(),
  fetched = ref(false)
const categories = ['all', 'devtools', 'web', 'docs', 'data', 'productivity']
const icons = {
  devtools: Code,
  web: Globe,
  docs: BookOpen,
  data: Database,
  productivity: ListChecks
}
const filtered = computed(() =>
  entries.value.filter(
    (entry) =>
      (category.value === 'all' || entry.category === category.value) &&
      `${entry.capability.name} ${entry.capability.description} ${description(entry)}`
        .toLowerCase()
        .includes(query.value.toLowerCase())
  )
)
function description(entry: McpCatalogEntry) {
  if (locale.value === 'zh-CN' && !entry.capability.id.startsWith('registry-'))
    return t(`mcpMarket.descriptions.${entry.template.id}`)
  return entry.capability.description
}
function installed(entry: McpCatalogEntry) {
  return props.inventory.entries.some((item) => item.id === entry.template.id)
}
function choose(entry: McpCatalogEntry) {
  selected.value = entry
  folder.value = props.root
  error.value = ''
  open.value = true
}
const configPreview = computed(() => {
  if (!selected.value) return ''
  const { id, ...configuration } = selected.value.template
  if (selected.value.requiresRoot)
    configuration.args = [
      ...(configuration.args ?? []),
      folder.value || t('mcpMarket.chooseFolder')
    ]
  return JSON.stringify({ mcpServers: { [id]: configuration } }, null, 2)
})
let generation = 0
async function search(more = false) {
  const ticket = ++generation
  remoteBusy.value = true
  error.value = ''
  try {
    const result = await getApi().agentSettings.mcp.market({
      query: query.value,
      ...(more && nextCursor.value ? { cursor: nextCursor.value } : {})
    })
    if (ticket !== generation) return
    const merged = more ? [...entries.value, ...result.entries] : result.entries
    entries.value = [...new Map(merged.map((entry) => [entry.capability.id, entry])).values()]
    offline.value = result.offline
    nextCursor.value = result.nextCursor
    fetched.value = true
  } catch {
    if (ticket === generation) {
      offline.value = true
      error.value = t('mcpMarket.loadError')
    }
  } finally {
    if (ticket === generation) remoteBusy.value = false
  }
}
async function pickFolder() {
  const picked = await getApi().workspace.pickDirectory()
  if (picked) folder.value = picked
}
async function install() {
  const entry = selected.value
  if (!entry) return
  busy.value = true
  error.value = ''
  try {
    const result = await getApi().agentSettings.mcp.install({
      catalogId: entry.capability.id,
      revision: props.inventory.revision,
      ...(props.root ? { root: props.root } : {}),
      ...(folder.value ? { folder: folder.value } : {})
    })
    emit('installed', result)
    open.value = false
  } catch {
    error.value = t('mcpMarket.installError')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="feature-stack" data-testid="mcp-market">
    <div class="feature-actions">
      <Button @click="emit('back')"
        ><ArrowLeft class="size-4" />{{ t('mcpMarket.myServers') }}</Button
      ><span class="ml-auto feature-hint"
        >{{ t('mcpMarket.builtinSource') }} · {{ MCP_CATALOG.length }}</span
      >
    </div>
    <div class="feature-row !border-0 !py-0">
      <div>
        <h2 class="!mb-1">{{ t('mcpMarket.title') }}</h2>
        <p class="feature-hint">{{ t('mcpMarket.previewHint') }}</p>
      </div>
      <Server class="size-7 text-[var(--text-tertiary)]" />
    </div>
    <form class="feature-actions" @submit.prevent="search()">
      <div class="relative min-w-[180px] flex-1">
        <Search
          class="pointer-events-none absolute left-3 top-3 size-4 text-[var(--text-tertiary)]"
        /><input
          v-model="query"
          class="feature-input !pl-9"
          :placeholder="t('mcpMarket.search')"
          :aria-label="t('mcpMarket.search')"
          maxlength="200"
        />
      </div>
      <Button type="submit" :disabled="remoteBusy"
        ><Globe class="size-4" />{{ t('mcpMarket.searchRegistry') }}</Button
      >
    </form>
    <div class="feature-actions" role="group" :aria-label="t('mcpMarket.categories')">
      <Button
        v-for="item in categories"
        :key="item"
        size="sm"
        :variant="category === item ? 'primary' : 'secondary'"
        :aria-pressed="category === item"
        @click="category = item"
        >{{ t(`mcpMarket.categoriesList.${item}`) }}</Button
      >
    </div>
    <p v-if="remoteBusy" role="status" class="feature-hint">{{ t('mcpMarket.registryLoading') }}</p>
    <p v-else-if="offline && fetched" role="status" class="feature-hint">
      {{ t('mcpMarket.offline') }}
    </p>
    <SettingsFeedback v-if="!open" :error="error" />
    <div class="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      <article
        v-for="entry in filtered"
        :key="entry.capability.id"
        class="feature-card !mb-0 flex gap-4 !p-5"
        :data-testid="`mcp-market-${entry.template.id}`"
      >
        <div
          class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-tint)] text-[var(--accent)]"
        >
          <component :is="icons[entry.category]" class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-semibold">{{ entry.capability.name }}</h3>
            <span
              class="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
              >{{
                entry.capability.id.startsWith('registry-')
                  ? 'Official registry'
                  : t(`mcpMarket.categoriesList.${entry.category}`)
              }}</span
            >
          </div>
          <code
            class="my-2 block truncate rounded-md bg-[var(--bg-base)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
            :title="
              entry.template.url ||
              [entry.template.command, ...(entry.template.args ?? [])].join(' ')
            "
            >{{
              entry.template.url ||
              [entry.template.command, ...(entry.template.args ?? [])].join(' ')
            }}</code
          >
          <p class="feature-hint">{{ description(entry) }}</p>
          <div class="mt-3 flex justify-end">
            <Button
              size="sm"
              :variant="installed(entry) ? 'secondary' : 'primary'"
              :disabled="installed(entry)"
              @click="choose(entry)"
              ><Download v-if="!installed(entry)" class="size-3.5" />{{
                t(installed(entry) ? 'mcpMarket.installed' : 'mcpMarket.install')
              }}</Button
            >
          </div>
        </div>
      </article>
    </div>
    <div v-if="!filtered.length && !remoteBusy" class="feature-empty">
      {{ t('mcpMarket.noResults') }}
    </div>
    <div v-if="nextCursor" class="flex justify-center">
      <Button :disabled="remoteBusy" @click="search(true)">{{ t('mcpMarket.loadMore') }}</Button>
    </div>
    <Dialog v-model:open="open" :title="t('mcpMarket.review')" large
      ><div v-if="selected" class="agent-settings feature-stack">
        <p class="feature-hint">{{ t('mcpMarket.reviewHint') }}</p>
        <p class="feature-hint">
          {{ t('agentSettings.scope') }} ·
          {{ root ? t('agentSettings.project') + ' · ' + root : t('agentSettings.global') }}
        </p>
        <p v-if="selected.notes" class="feature-hint">{{ selected.notes }}</p>
        <div v-if="selected.requiresRoot" class="feature-actions">
          <Button :disabled="busy" @click="pickFolder"
            ><FolderOpen class="size-4" />{{ t('mcpMarket.chooseFolder') }}</Button
          ><span class="feature-hint break-all">{{ folder }}</span>
        </div>
        <pre
          class="max-h-[320px] overflow-auto rounded-xl bg-[var(--bg-base)] p-4 text-xs leading-relaxed text-[var(--text-secondary)]"
          data-testid="mcp-install-preview"
          >{{ configPreview }}</pre>
        <SettingsFeedback :error="error" />
        <div class="feature-actions justify-end">
          <Button :disabled="busy" @click="open = false">{{ t('agentSettings.cancel') }}</Button
          ><Button
            variant="primary"
            :disabled="busy || (selected.requiresRoot && !folder)"
            @click="install"
            >{{ t('mcpMarket.confirmInstall') }}</Button
          >
        </div>
      </div></Dialog
    >
  </div>
</template>
