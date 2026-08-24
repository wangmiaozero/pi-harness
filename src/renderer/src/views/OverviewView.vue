<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  RefreshCw,
  FolderOpen,
  RotateCcw,
  Download,
  ArrowUpCircle,
  Cpu,
  Box,
  Activity,
  Circle,
  Copy,
  Terminal
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import Button from '@renderer/components/ui/Button.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { usePiStore } from '@renderer/stores/pi'
import { useProvidersStore } from '@renderer/stores/providers'
import { useModelsStore } from '@renderer/stores/models'
import { callApi, getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { PI_INSTALL_COMMAND } from '@shared/constants/pi-install'
import EnvironmentTaskProgress from '@renderer/components/environment/EnvironmentTaskProgress.vue'

const { t } = useI18n()
const router = useRouter()
const piStore = usePiStore()
const providersStore = useProvidersStore()
const modelsStore = useModelsStore()
const actionMessage = ref('')

const env = computed(() => piStore.environment)
const canInstallPi = computed(() => env.value?.nodeRuntime.ready ?? false)
const nodeStatusLabel = computed(() => {
  const runtime = env.value?.nodeRuntime
  if (!runtime?.nodeInstalled) return t('overview.nodeMissing')
  if (!runtime.nodeSupported) {
    return t('overview.nodeOutdated', { version: runtime.nodeVersion ?? '?' })
  }
  if (!runtime.npmInstalled) return t('overview.npmMissing')
  return t('overview.nodeReady', {
    node: runtime.nodeVersion ?? 'Node.js',
    npm: runtime.npmVersion ?? 'npm'
  })
})
const piInstallGuidance = computed(() =>
  canInstallPi.value ? t('overview.piRequiredReadyHint') : t('overview.piRequiredNodeHint')
)
const nodeStepLabel = computed(() =>
  canInstallPi.value
    ? t('overview.nodeDetected')
    : env.value?.nodeRuntime.nodeInstalled && !env.value.nodeRuntime.nodeSupported
      ? t('overview.upgradeNodeFirst')
      : t('overview.installNodeFirst')
)
const nodeActionLabel = computed(() =>
  env.value?.nodeRuntime.nodeInstalled && !env.value.nodeRuntime.nodeSupported
    ? t('overview.upgradeNode')
    : t('overview.installNode')
)

const stats = computed(() => ({
  providers: providersStore.items.length,
  enabledProviders: providersStore.items.filter((p) => p.enabled).length,
  models: modelsStore.items.length,
  enabledModels: modelsStore.items.filter((m) => m.enabled).length
}))

const configStatusLabel = computed(() => {
  if (env.value?.configValid) return t('common.valid')
  if (env.value?.configReadable) return t('common.invalid')
  return t('overview.unreadable')
})

const setupWarnings = computed(() => {
  const warnings: string[] = []
  if (providersStore.items.length > 0 && modelsStore.items.length === 0) {
    warnings.push(t('overview.setupWarnNoModels'))
  }
  const { providerKey, modelId } = modelsStore.active
  if (providerKey) {
    const provider = providersStore.items.find((p) => p.key === providerKey)
    if (!provider) {
      warnings.push(t('overview.setupWarnActiveMissing', { provider: providerKey }))
    } else if (modelId) {
      const modelExists = modelsStore.items.some(
        (m) => m.modelId === modelId && m.providerId === provider.id
      )
      if (!modelExists) {
        warnings.push(
          t('overview.setupWarnActiveModelMissing', { provider: providerKey, model: modelId })
        )
      }
    }
  }
  return warnings
})

async function refreshAll() {
  await Promise.all([piStore.refresh(), providersStore.fetchList(), modelsStore.fetchList()])
  toast.success(t('common.refreshed'))
}

async function reloadConfig() {
  try {
    await callApi(() => getApi().config.reload())
    await refreshAll()
    toast.success(t('overview.configReloaded'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('overview.reloadFailed'))
  }
}

async function openConfigDir() {
  const dir = env.value?.configDir
  if (!dir) {
    toast.error(t('overview.configDirUnknown'))
    return
  }
  await callApi(() => getApi().system.openPath(dir))
}

async function installPi() {
  const ok = await askConfirm({
    title: t('overview.bootstrapConfirmTitle'),
    description: t('overview.bootstrapConfirm'),
    confirmLabel: t('overview.bootstrapAction'),
    tone: 'primary'
  })
  if (!ok) return
  try {
    const result = await piStore.bootstrap()
    actionMessage.value = result.message
    await refreshAll()
    toast.success(t('overview.installOk'), { description: result.message })
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function installNode() {
  const ok = await askConfirm({
    title: nodeActionLabel.value,
    description: t('overview.nodeInstallConfirm'),
    confirmLabel: nodeActionLabel.value,
    tone: 'primary'
  })
  if (!ok) return
  try {
    await piStore.installNode()
    await refreshAll()
    toast.success(t('overview.nodeInstallOk'))
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('common.failed'))
  }
}

async function copyInstallCommand() {
  try {
    await getApi().pi.copyInstallCommand()
    toast.success(t('overview.installCommandCopied'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function updatePi() {
  if (!env.value?.installed) return
  const ok = await askConfirm({
    title: t('overview.updateConfirmTitle'),
    description: t('overview.updateConfirm'),
    confirmLabel: t('overview.updateAction'),
    tone: 'primary'
  })
  if (!ok) return
  try {
    const result = await piStore.update(false)
    actionMessage.value = result.message
    if (
      result.previousVersion &&
      result.currentVersion &&
      result.previousVersion !== result.currentVersion
    ) {
      toast.success(t('overview.updateOk'), { description: result.message })
    } else {
      toast.info(t('overview.alreadyLatest'), { description: result.message })
    }
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function reinstallPi() {
  const ok = await askConfirm({
    title: t('overview.reinstallPi'),
    description: t('overview.reinstallConfirm'),
    confirmLabel: t('overview.reinstallPi'),
    tone: 'primary'
  })
  if (!ok) return
  try {
    const result = await piStore.reinstall()
    actionMessage.value = result.message
    await refreshAll()
    toast.success(t('overview.installOk'), { description: result.message })
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('common.failed'))
  }
}

onMounted(() => {
  void refreshAll()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header
      class="flex shrink-0 items-center justify-between gap-3 px-5 h-[var(--height-page-header)] border-b border-[var(--border-subtle)]"
    >
      <div class="min-w-0">
        <h1 class="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          {{ $t('overview.title') }}
        </h1>
        <p class="text-[11.5px] text-[var(--text-tertiary)] -mt-0.5">
          {{ $t('overview.subtitle') }}
        </p>
      </div>
      <Button variant="ghost" size="sm" :loading="piStore.loading" @click="refreshAll">
        <RefreshCw class="size-3.5" :stroke-width="1.75" />
        {{ $t('common.refresh') }}
      </Button>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div class="w-full px-5 py-5 space-y-5">
        <!-- Setup warnings as compact banners, not big Cards. -->
        <div v-if="setupWarnings.length > 0" class="space-y-2">
          <div
            v-for="(warn, i) in setupWarnings"
            :key="i"
            class="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--warning)]/30 bg-[var(--warning-tint)] px-3 py-2.5 text-[11.5px] leading-snug text-[var(--text-secondary)]"
          >
            <Circle
              class="mt-1 size-2 shrink-0 fill-current text-[var(--warning)]"
              :stroke-width="0"
            />
            <span>{{ warn }}</span>
          </div>
        </div>

        <section
          v-if="env && env.state !== 'ready'"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--warning)]/35 bg-[var(--bg-surface)]"
        >
          <div class="flex items-start gap-3 px-4 py-3.5">
            <div
              class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--warning-tint)] text-[var(--warning)]"
            >
              <Terminal class="size-4" :stroke-width="1.75" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-[13px] font-semibold text-[var(--text-primary)]">
                  {{ $t('overview.environmentRepairTitle') }}
                </h2>
                <Badge :tone="canInstallPi ? 'success' : 'warning'">
                  {{ nodeStatusLabel }}
                </Badge>
              </div>
              <p class="mt-1 text-[11.5px] leading-5 text-[var(--text-secondary)]">
                {{ piInstallGuidance }}
              </p>
            </div>
          </div>

          <div class="border-t border-[var(--border-subtle)] px-4 py-3 space-y-2.5">
            <div class="flex items-center gap-2.5">
              <span
                class="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[10px] font-semibold text-[var(--text-secondary)]"
              >
                1
              </span>
              <span class="min-w-0 flex-1 text-[11.5px] text-[var(--text-secondary)]">
                {{ nodeStepLabel }}
              </span>
              <Button
                v-if="!canInstallPi"
                variant="secondary"
                size="sm"
                :loading="piStore.mutating"
                :disabled="piStore.mutating"
                @click="installNode"
              >
                <Download class="size-3.5" :stroke-width="1.75" />
                {{ nodeActionLabel }}
              </Button>
            </div>

            <div class="flex items-center gap-2.5">
              <span
                class="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[10px] font-semibold text-[var(--text-secondary)]"
              >
                2
              </span>
              <code
                class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-window)] px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-primary)]"
              >
                {{ PI_INSTALL_COMMAND }}
              </code>
              <Button variant="ghost" size="sm" @click="copyInstallCommand">
                <Copy class="size-3.5" :stroke-width="1.75" />
                {{ $t('overview.copyCommand') }}
              </Button>
            </div>
          </div>

          <div v-if="piStore.installTask" class="border-t border-[var(--border-subtle)] px-4 py-3">
            <EnvironmentTaskProgress :task="piStore.installTask" @cancel="piStore.cancelInstall" />
          </div>

          <div
            class="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-4 py-2.5"
          >
            <Button
              variant="primary"
              size="sm"
              :loading="piStore.mutating"
              :disabled="piStore.mutating"
              @click="installPi"
            >
              <Download class="size-3.5" :stroke-width="1.75" />
              {{
                piStore.mutating ? $t('overview.installing') : $t('overview.oneClickEnvironment')
              }}
            </Button>
            <Button variant="ghost" size="sm" :disabled="piStore.mutating" @click="refreshAll">
              <RefreshCw class="size-3.5" :stroke-width="1.75" />
              {{ $t('common.refresh') }}
            </Button>
          </div>
        </section>

        <EnvironmentTaskProgress
          v-if="env?.state === 'ready' && piStore.installTask"
          :task="piStore.installTask"
          @cancel="piStore.cancelInstall"
        />

        <!-- Current Model — the focal point. Single Surface, no Card. -->
        <div
          class="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p
                class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
              >
                {{ $t('overview.currentModel') }}
              </p>
              <template v-if="modelsStore.active.providerKey && modelsStore.active.modelId">
                <p class="mt-1 flex flex-wrap items-baseline gap-2">
                  <span
                    class="font-[family-name:var(--font-mono)] text-[18px] font-semibold text-[var(--text-primary)]"
                  >
                    {{ modelsStore.active.modelId }}
                  </span>
                  <span class="text-[12px] text-[var(--text-tertiary)]">{{
                    $t('overview.from')
                  }}</span>
                  <span class="text-[12.5px] text-[var(--accent)]">{{
                    modelsStore.active.providerKey
                  }}</span>
                </p>
                <p
                  v-if="
                    modelsStore.items.find((m) =>
                      modelsStore.isActive(
                        m,
                        providersStore.items.find((p) => p.id === m.providerId)?.key
                      )
                    )?.displayName
                  "
                  class="mt-0.5 text-[12px] text-[var(--text-secondary)]"
                >
                  {{
                    modelsStore.items.find((m) =>
                      modelsStore.isActive(
                        m,
                        providersStore.items.find((p) => p.id === m.providerId)?.key
                      )
                    )?.displayName
                  }}
                </p>
              </template>
              <EmptyState
                v-else
                :title="$t('overview.noActiveModel')"
                :description="$t('overview.noActiveModelHint')"
              />
            </div>
            <Button variant="secondary" size="sm" @click="router.push('/models')">
              <Cpu class="size-3.5" :stroke-width="1.75" />
              {{ $t('overview.manageModels') }}
            </Button>
          </div>
        </div>

        <!-- Pi environment — single inspector section. -->
        <InspectorSection>
          <template #title>{{ $t('overview.environment') }}</template>
          <PropertyRow :label="$t('overview.cliPath')" mono>
            {{ env?.cliPath ?? $t('common.unknown') }}
          </PropertyRow>
          <PropertyRow label="Node.js" mono>
            {{ env?.nodeRuntime.nodeVersion ?? $t('common.notFound') }} ·
            {{ env?.nodeRuntime.nodePath ?? '—' }}
          </PropertyRow>
          <PropertyRow label="npm" mono>
            {{ env?.nodeRuntime.npmVersion ?? $t('common.notFound') }} ·
            {{ env?.nodeRuntime.npmPath ?? '—' }}
          </PropertyRow>
          <PropertyRow label="npm prefix" mono>
            {{ env?.nodeRuntime.npmPrefix ?? '—' }}
          </PropertyRow>
          <PropertyRow :label="$t('overview.configDir')" mono>
            {{ env?.configDir ?? $t('common.unknown') }}
          </PropertyRow>
          <PropertyRow :label="$t('overview.platform')" mono>
            {{ env?.platform }} / {{ env?.arch }}
          </PropertyRow>
          <PropertyRow v-if="env?.configError" :label="$t('overview.error')">
            <span class="text-[var(--error)]">{{ env.configError }}</span>
          </PropertyRow>
        </InspectorSection>

        <!-- Quick stats — single horizontal surface, not 4 separate Cards. -->
        <div
          class="flex flex-wrap items-stretch overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-x divide-[var(--border-subtle)]"
        >
          <div class="flex flex-1 items-center gap-3 px-4 py-3">
            <Box class="size-3.5 text-[var(--text-tertiary)]" :stroke-width="1.75" />
            <div class="min-w-0">
              <p class="text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
                {{ $t('overview.providers') }}
              </p>
              <p class="text-[12.5px] text-[var(--text-primary)]">
                <span class="font-semibold tabular-nums">{{ stats.enabledProviders }}</span>
                <span class="text-[var(--text-tertiary)]"> / {{ stats.providers }}</span>
              </p>
            </div>
          </div>
          <div class="flex flex-1 items-center gap-3 px-4 py-3">
            <Cpu class="size-3.5 text-[var(--text-tertiary)]" :stroke-width="1.75" />
            <div class="min-w-0">
              <p class="text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
                {{ $t('overview.models') }}
              </p>
              <p class="text-[12.5px] text-[var(--text-primary)]">
                <span class="font-semibold tabular-nums">{{ stats.enabledModels }}</span>
                <span class="text-[var(--text-tertiary)]"> / {{ stats.models }}</span>
              </p>
            </div>
          </div>
          <div class="flex flex-1 items-center gap-3 px-4 py-3">
            <Activity class="size-3.5 text-[var(--text-tertiary)]" :stroke-width="1.75" />
            <div class="min-w-0">
              <p class="text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
                {{ $t('overview.config') }}
              </p>
              <p class="text-[12.5px]">
                <Badge
                  :tone="env?.configValid ? 'success' : env?.configReadable ? 'warning' : 'error'"
                >
                  {{ configStatusLabel }}
                </Badge>
              </p>
            </div>
          </div>
        </div>

        <!-- Quick actions — a single toolbar strip. -->
        <div class="flex flex-wrap items-center gap-1.5">
          <span
            class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)] pr-1"
          >
            {{ $t('overview.quickActions') }}
          </span>
          <Button
            v-if="env?.installed"
            :variant="piStore.updateAvailable ? 'primary' : 'secondary'"
            size="sm"
            :loading="piStore.mutating"
            :disabled="piStore.mutating"
            @click="updatePi"
          >
            <ArrowUpCircle class="size-3.5" :stroke-width="1.75" />
            {{ piStore.mutating ? $t('overview.updating') : $t('overview.updatePi') }}
          </Button>
          <Button
            v-if="env?.installed"
            variant="secondary"
            size="sm"
            :disabled="piStore.mutating"
            @click="reinstallPi"
          >
            <Download class="size-3.5" :stroke-width="1.75" />
            {{ $t('overview.reinstallPi') }}
          </Button>
          <Button variant="ghost" size="sm" @click="router.push('/providers')">
            <Box class="size-3.5" :stroke-width="1.75" />
            {{ $t('overview.manageProviders') }}
          </Button>
          <Button variant="ghost" size="sm" @click="reloadConfig">
            <RotateCcw class="size-3.5" :stroke-width="1.75" />
            {{ $t('overview.reloadConfig') }}
          </Button>
          <Button variant="ghost" size="sm" :disabled="!env?.configDir" @click="openConfigDir">
            <FolderOpen class="size-3.5" :stroke-width="1.75" />
            {{ $t('overview.openConfigDir') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
