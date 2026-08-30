<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { useModelsStore } from '@renderer/stores/models'
import { usePiStore } from '@renderer/stores/pi'
import { useSettingsStore } from '@renderer/stores/settings'
import { useProvidersStore } from '@renderer/stores/providers'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useI18n } from 'vue-i18n'
import { Search, X } from '@lucide/vue'

export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  group: string
  keywords?: string
  run: () => void | Promise<void>
}

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const router = useRouter()
const models = useModelsStore()
const providers = useProvidersStore()
const pi = usePiStore()
const settings = useSettingsStore()
const workspace = useWorkspaceStore()

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

function openPaletteFromEvent() {
  open.value = true
}

onMounted(() => {
  window.addEventListener('pi-harness:open-palette', openPaletteFromEvent)
})

onBeforeUnmount(() => {
  window.removeEventListener('pi-harness:open-palette', openPaletteFromEvent)
})

const commands = computed<PaletteCommand[]>(() => {
  const cmds: PaletteCommand[] = [
    {
      id: 'nav-overview',
      label: t('palette.goOverview'),
      group: t('palette.groupNav'),
      keywords: 'home dashboard',
      run: () => {
        void router.push('/')
      }
    },
    {
      id: 'nav-workspace',
      label: t('palette.goWorkspace'),
      group: t('palette.groupNav'),
      keywords: 'chat session agent',
      run: () => {
        void router.push('/workspace')
      }
    },
    {
      id: 'nav-providers',
      label: t('palette.goProviders'),
      group: t('palette.groupNav'),
      run: () => {
        void router.push('/providers')
      }
    },
    {
      id: 'nav-models',
      label: t('palette.goModels'),
      group: t('palette.groupNav'),
      run: () => {
        void router.push('/models')
      }
    },
    {
      id: 'nav-skills',
      label: t('palette.goSkills'),
      group: t('palette.groupNav'),
      run: () => {
        void router.push('/skills')
      }
    },
    {
      id: 'nav-config',
      label: t('palette.openConfig'),
      group: t('palette.groupNav'),
      keywords: 'json models settings editor',
      run: () => {
        void router.push('/settings/config')
      }
    },
    {
      id: 'nav-diagnostics',
      label: t('palette.goDiagnostics'),
      group: t('palette.groupNav'),
      run: () => {
        void router.push('/settings/diagnostics')
      }
    },
    {
      id: 'nav-settings',
      label: t('palette.goSettings'),
      group: t('palette.groupNav'),
      keywords: 'preferences',
      run: () => {
        void router.push('/settings')
      }
    },
    {
      id: 'workspace-new-session',
      label: t('palette.newSession'),
      group: t('palette.groupActions'),
      keywords: 'chat',
      run: () => {
        void router.push('/workspace')
      }
    },
    {
      id: 'workspace-abort',
      label: t('palette.abortAgent'),
      group: t('palette.groupActions'),
      run: () => {
        window.dispatchEvent(new CustomEvent('pi-harness:abort-agent'))
      }
    },
    {
      id: 'workspace-compact',
      label: t('palette.compactSession'),
      group: t('palette.groupActions'),
      run: () => {
        window.dispatchEvent(new CustomEvent('pi-harness:compact-session'))
      }
    },
    {
      id: 'workspace-open-folder',
      label: t('palette.openWorkspaceFolder'),
      group: t('palette.groupWorkspace'),
      keywords: 'open folder project',
      run: () => {
        void router.push('/workspace')
        window.dispatchEvent(new CustomEvent('pi-harness:workspace-open-folder'))
      }
    },
    {
      id: 'workspace-open-file',
      label: t('palette.openWorkspaceFile'),
      group: t('palette.groupWorkspace'),
      keywords: 'code-workspace import',
      run: () => {
        void router.push('/workspace')
        window.dispatchEvent(new CustomEvent('pi-harness:workspace-open-file'))
      }
    },
    {
      id: 'workspace-add-folder',
      label: t('palette.addFolderToWorkspace'),
      group: t('palette.groupWorkspace'),
      keywords: 'multi root',
      run: () => {
        void router.push('/workspace')
        window.dispatchEvent(new CustomEvent('pi-harness:workspace-add-folder'))
      }
    },
    {
      id: 'workspace-save',
      label: t('palette.saveWorkspace'),
      group: t('palette.groupWorkspace'),
      keywords: 'code-workspace export',
      run: () => {
        void router.push('/workspace')
        window.dispatchEvent(new CustomEvent('pi-harness:workspace-save'))
      }
    },
    {
      id: 'add-provider',
      label: t('palette.addProvider'),
      group: t('palette.groupActions'),
      run: () => {
        void router.push({ path: '/providers', query: { action: 'create' } })
      }
    },
    {
      id: 'add-model',
      label: t('palette.addModel'),
      group: t('palette.groupActions'),
      run: () => {
        void router.push({ path: '/models', query: { action: 'create' } })
      }
    },
    {
      id: 'backup-now',
      label: t('palette.backupNow'),
      group: t('palette.groupActions'),
      run: async () => {
        await settings.createBackup('palette')
        toast.success(t('palette.backupCreated'))
      }
    },
    {
      id: 'refresh-pi',
      label: t('palette.refreshEnvironment'),
      group: t('palette.groupActions'),
      run: async () => {
        await Promise.all([pi.refresh(), providers.fetchList(), models.fetchList()])
        toast.success(t('palette.environmentRefreshed'))
      }
    },
    {
      id: 'install-pi',
      label: t('overview.oneClickEnvironment'),
      group: t('palette.groupActions'),
      keywords: 'npm install pi coding agent',
      run: async () => {
        if (!pi.environment) await pi.detect()
        if (pi.environment?.state === 'ready') {
          toast.info(t('overview.updateHint'))
          return
        }
        const ok = await askConfirm({
          title: t('overview.bootstrapConfirmTitle'),
          description: t('overview.bootstrapConfirm'),
          confirmLabel: t('overview.bootstrapAction'),
          tone: 'primary'
        })
        if (!ok) return
        const result = await pi.bootstrap()
        toast.success(t('overview.installOk'), { description: result.message })
      }
    },
    {
      id: 'update-pi',
      label: t('overview.updatePi'),
      group: t('palette.groupActions'),
      keywords: 'upgrade self',
      run: async () => {
        if (!pi.installed) {
          toast.info(t('overview.installHint'))
          return
        }
        const ok = await askConfirm({
          title: t('overview.updateConfirmTitle'),
          description: t('overview.updateConfirm'),
          confirmLabel: t('overview.updateAction'),
          tone: 'primary'
        })
        if (!ok) return
        const result = await pi.update(false)
        toast.success(result.message)
      }
    },
    {
      id: 'open-pi-folder',
      label: t('palette.openConfigFolder'),
      group: t('palette.groupActions'),
      run: async () => {
        const env = pi.environment ?? (await pi.detect(), pi.environment)
        if (env?.configDir) await getApi().system.openPath(env.configDir)
        else toast.error(t('overview.configDirUnknown'))
      }
    },
    {
      id: 'check-updates',
      label: t('palette.checkUpdates'),
      group: t('palette.groupActions'),
      hint: t('palette.updateUnavailable'),
      run: async () => {
        toast.info(t('palette.updateUnavailableHint'))
      }
    }
  ]

  for (const item of workspace.recentWorkspaces) {
    cmds.push({
      id: `workspace-recent-${item.id}`,
      label: t('palette.openRecentWorkspace', { name: item.name }),
      hint: item.workspaceFile || item.folderPaths.join(', '),
      group: t('palette.groupWorkspace'),
      keywords: `recent ${item.name} ${item.workspaceFile ?? ''}`,
      run: () => {
        void router.push('/workspace')
        window.dispatchEvent(new CustomEvent('pi-harness:workspace-open-recent', { detail: item }))
      }
    })
  }

  for (const folder of workspace.workspaceFolders) {
    cmds.push({
      id: `workspace-remove-${folder.id}`,
      label: t('palette.removeFolder', { name: folder.name }),
      group: t('palette.groupWorkspace'),
      keywords: `remove ${folder.name}`,
      run: async () => {
        const ok = await askConfirm({
          title: t('workspace.removeFolder'),
          description: folder.name,
          confirmLabel: t('workspace.removeFolder'),
          tone: 'danger'
        })
        if (!ok) return
        void router.push('/workspace')
        workspace.removeProject(folder.id)
        toast.success(t('workspace.projectRemoved'), { description: folder.name })
      }
    })
  }

  for (const m of models.items) {
    if (!m.enabled) continue
    cmds.push({
      id: `switch-${m.id}`,
      label: t('palette.switchTo', { model: m.displayName }),
      hint: `${m.providerId} / ${m.modelId}`,
      group: t('palette.groupSwitch'),
      keywords: `${m.modelId} ${m.providerId}`,
      run: async () => {
        await models.setActive(m.providerId, m.modelId)
        toast.success(t('palette.activeModel', { model: m.displayName }))
      }
    })
  }

  return cmds
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return commands.value
  return commands.value.filter((c) => {
    const hay = `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''} ${c.group}`.toLowerCase()
    return hay.includes(q)
  })
})

watch(open, async (v) => {
  if (v) {
    query.value = ''
    activeIndex.value = 0
    void workspace.refreshRecent()
    await nextTick()
    inputRef.value?.focus()
  }
})

watch(filtered, () => {
  activeIndex.value = 0
})

async function run(cmd: PaletteCommand) {
  open.value = false
  try {
    await cmd.run()
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('palette.commandFailed'))
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const cmd = filtered.value[activeIndex.value]
    if (cmd) void run(cmd)
  }
}

function preventImplicitClose(event: Event) {
  event.preventDefault()
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[60] bg-black/45 data-[state=open]:animate-[pi-fade-in_var(--motion-base)_var(--ease-out)]"
      />
      <DialogContent
        class="fixed left-1/2 top-[18%] z-[60] w-[min(580px,92vw)] -translate-x-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] shadow-[var(--shadow-dialog)] focus:outline-none data-[state=open]:animate-[pi-pop-in_var(--motion-base)_var(--ease-out)]"
        @interact-outside="preventImplicitClose"
        @escape-key-down="preventImplicitClose"
        @keydown="onKey"
      >
        <DialogTitle class="sr-only">{{ $t('titlebar.commandPalette') }}</DialogTitle>
        <div class="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 h-[42px]">
          <Search
            aria-hidden="true"
            class="size-3.5 shrink-0 text-[var(--text-tertiary)]"
            :stroke-width="1.75"
          />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            :placeholder="$t('palette.placeholder')"
            class="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
          <DialogClose
            class="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            :aria-label="$t('common.close')"
          >
            <X aria-hidden="true" class="size-3" :stroke-width="1.75" />
          </DialogClose>
        </div>
        <div class="max-h-[360px] overflow-y-auto py-1">
          <template v-if="filtered.length === 0">
            <p class="px-3 py-6 text-center text-[11.5px] text-[var(--text-tertiary)]">
              {{ $t('palette.empty') }}
            </p>
          </template>
          <button
            v-for="(cmd, i) in filtered"
            :key="cmd.id"
            type="button"
            class="flex w-full items-center gap-3 px-3 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)]"
            :class="
              i === activeIndex
                ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            "
            :style="{ minHeight: '34px' }"
            @mouseenter="activeIndex = i"
            @click="run(cmd)"
          >
            <span
              class="w-[88px] shrink-0 truncate text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
              :title="cmd.group"
            >
              {{ cmd.group }}
            </span>
            <span class="min-w-0 flex-1 truncate text-[12.5px]" :title="cmd.label">{{
              cmd.label
            }}</span>
            <span
              v-if="cmd.hint"
              class="shrink-0 truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
              :title="cmd.hint"
            >
              {{ cmd.hint }}
            </span>
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
