<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem
} from 'reka-ui'
import { Eye, Pencil, Plus, Trash2 } from '@lucide/vue'
import { getApi, getErrorPayload } from '@renderer/composables/useApi'
import type {
  OpenCodeCredential,
  OpenCodeFreeState,
  OpenCodeModel,
  OpenCodeTestOptions
} from '@shared/providers/opencode-free'
import { openCodeVerificationBlock, openCodeSelectionBlock } from '@shared/providers/opencode-free'
import Button from '../ui/Button.vue'
import Switch from '../ui/Switch.vue'
import Input from '../ui/Input.vue'
import Dialog from '../ui/Dialog.vue'
import { useModelsStore } from '@renderer/stores/models'
import { useProvidersStore } from '@renderer/stores/providers'

const { t, te } = useI18n()
const state = ref<OpenCodeFreeState | null>(null)
const busy = ref(false)
const search = ref('')
const filter = ref<'all' | 'free' | 'paid'>('all')
const models = useModelsStore()
const providers = useProvidersStore()
const credentials = computed(() => state.value?.credentials ?? [])
const activeCredential = computed(() =>
  credentials.value.find((key) => key.id === state.value?.activeCredentialId)
)
const knownModels = computed(
  () => state.value?.models.filter((model) => model.price !== 'unknown') ?? []
)
const visibleModels = computed(() => {
  const selected = new Set(state.value?.workspaceModelIds ?? [])
  return knownModels.value
    .filter(
      (model) =>
        (filter.value === 'all' || model.price === filter.value) &&
        `${model.id} ${model.name}`.toLowerCase().includes(search.value.toLowerCase().trim())
    )
    .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)))
})
const hiddenCount = computed(() => (state.value?.models.length ?? 0) - knownModels.value.length)
const credentialDialog = ref(false)
const editingId = ref<string | undefined>()
const credentialName = ref('')
const credentialValue = ref('')
const revealed = ref(false)
const revealedStored = ref(false)
const revealing = ref(false)
let revealGeneration = 0
const dataConsent = ref(false)
const deleteTarget = ref<OpenCodeCredential | null>(null)
const deleteDialog = ref(false)
const verifyTarget = ref<OpenCodeModel | null>(null)
const verifyDialog = ref(false)
const paidPermission = ref(false)
const enableAfterVerification = ref(false)
const moreActionsOpen = ref(false)
const batchDialog = ref(false)
const batchPaidPermission = ref(false)
const batchRunning = ref(false)
const batchProgress = ref({ done: 0, total: 0, name: '' })
const batchCandidates = computed(() => knownModels.value.filter((model) => !blockReason(model)))
const batchPaidCount = computed(
  () => batchCandidates.value.filter((model) => model.price === 'paid').length
)
const batchSkipped = computed(
  () => (state.value?.models.length ?? 0) - batchCandidates.value.length
)
const batchSkippedReasons = computed(() => {
  const counts = new Map<string, number>()
  for (const model of state.value?.models ?? []) {
    const reason = blockReason(model)
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return [...counts].map(([code, count]) => ({ code, count }))
})
let batchCancelled = false
let disposed = false
let batchToast: string | number | undefined
let cancellation: Promise<void> | undefined

type Feedback = 'connection' | 'refresh' | { modelId: string }
function notifyResult(result: OpenCodeFreeState, action: Feedback, id?: string | number): void {
  const model =
    typeof action === 'object'
      ? result.models.find((item) => item.id === action.modelId)
      : undefined
  const code = result.error ?? model?.errorCode
  const description = [model?.name, result.httpStatus ? `HTTP ${result.httpStatus}` : null]
    .filter(Boolean)
    .join(' · ')
  const options = { id, duration: 5000, ...(description ? { description } : {}) }
  if (code) {
    toast.error(t(`openCode.errors.${code}`, t('openCode.failed')), options)
  } else if (action === 'refresh') {
    toast.success(t('common.refreshed'), options)
  } else if (action === 'connection' && result.connectionStatus === 'CONNECTED') {
    toast.success(t('openCode.errors.CONNECTED'), options)
  } else if (model && !openCodeSelectionBlock(result, model)) {
    toast.success(`${model.name} · ${t('openCode.values.verified')}`, options)
  } else {
    toast.warning(t('openCode.errors.NOT_VERIFIED'), options)
  }
}
function operationError(error: unknown): string {
  const payload = getErrorPayload(error)
  for (const code of [payload.message, payload.code]) {
    const key = `openCode.errors.${code}`
    if (/^[A-Z_]+$/.test(code) && te(key)) return t(key)
  }
  return t('openCode.failed')
}
async function run(work: () => Promise<OpenCodeFreeState>, feedback?: Feedback): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  const progress = feedback
    ? toast.loading(
        `${typeof feedback === 'object' ? t('openCode.verifyShort') : feedback === 'connection' ? t('openCode.test') : t('openCode.refresh')} · ${t('common.loading')}`
      )
    : undefined
  try {
    state.value = await work()
    if (feedback) notifyResult(state.value, feedback, progress)
    await Promise.all([models.fetchList(), providers.fetchList()])
    return true
  } catch (error) {
    const message = operationError(error)
    if (progress !== undefined) toast.error(message, { id: progress, duration: 5000 })
    else toast.error(message)
    return false
  } finally {
    busy.value = false
  }
}
async function runDiagnostic(action: 'connection' | 'refresh'): Promise<void> {
  moreActionsOpen.value = false
  await run(
    () =>
      action === 'connection'
        ? getApi().openCodeFree.test('connection')
        : getApi().openCodeFree.refresh(),
    action
  )
}
async function setWorkspaceVisibility(
  showInWorkspace: boolean,
  modelIds = state.value?.workspaceModelIds ?? []
): Promise<void> {
  await run(() =>
    getApi().openCodeFree.setWorkspaceVisibility({ showInWorkspace, modelIds: [...modelIds] })
  )
}
async function enableWorkspaceModel(modelId: string): Promise<OpenCodeFreeState> {
  const ids = new Set(state.value?.workspaceModelIds ?? [])
  ids.add(modelId)
  return getApi().openCodeFree.setWorkspaceVisibility({ showInWorkspace: true, modelIds: [...ids] })
}
async function toggleWorkspaceModel(modelId: string, visible: boolean): Promise<void> {
  if (busy.value) return
  if (!visible) {
    const ids = (state.value?.workspaceModelIds ?? []).filter((id) => id !== modelId)
    return setWorkspaceVisibility(state.value?.showInWorkspace === true, ids)
  }
  const model = state.value?.models.find((item) => item.id === modelId)
  if (!model) return
  const reason = blockReason(model)
  if (reason) return showModelBlock(model, reason)
  if (!openCodeSelectionBlock(state.value, model)) {
    await run(() => enableWorkspaceModel(model.id))
  } else if (model.price === 'paid') {
    beginVerification(model)
    enableAfterVerification.value = true
  } else {
    await performVerification(model.id, false, true)
  }
}
async function useCredential(profile: OpenCodeCredential): Promise<void> {
  if (profile.id === state.value?.activeCredentialId && state.value.enabled) {
    await run(() =>
      getApi().openCodeFree.configure({ enabled: false, authMode: 'inference', consent: true })
    )
    return
  }
  await run(async () => {
    // Keep the newly selected key visible even if its subsequent catalog refresh fails.
    state.value = await getApi().openCodeFree.activateCredential(profile.id)
    return getApi().openCodeFree.refresh()
  }, 'refresh')
}
function beginBatchVerification(): void {
  if (busy.value) return
  batchPaidPermission.value = false
  batchDialog.value = true
}
async function cancelOperation(): Promise<void> {
  batchCancelled = true
  cancellation = getApi()
    .openCodeFree.cancel()
    .catch(() => {
      if (!disposed) toast.error(t('openCode.failed'))
    })
  await cancellation
}
async function confirmBatchVerification(): Promise<void> {
  if (
    busy.value ||
    !batchCandidates.value.length ||
    (batchPaidCount.value && !batchPaidPermission.value)
  )
    return
  const queue = batchCandidates.value.map((model) => ({
    id: model.id,
    price: model.price,
    service: model.service,
    cost: JSON.stringify(model.cost)
  }))
  const credentialId = state.value?.activeCredentialId ?? undefined
  if (!credentialId) return
  const allowPaid = batchPaidPermission.value
  const completed: string[] = []
  let skipped = batchSkipped.value
  batchDialog.value = false
  batchCancelled = false
  cancellation = undefined
  busy.value = true
  batchRunning.value = true
  batchProgress.value = { done: 0, total: queue.length, name: '' }
  batchToast = toast.loading(t('openCode.verifyAll'))
  try {
    for (const candidate of queue) {
      if (batchCancelled || disposed) break
      // Never carry approval over to a different key, new price, or newly blocked model.
      if (state.value?.activeCredentialId !== credentialId) break
      const model = state.value?.models.find((item) => item.id === candidate.id)
      if (
        !model ||
        blockReason(model) ||
        model.price !== candidate.price ||
        model.service !== candidate.service ||
        JSON.stringify(model.cost) !== candidate.cost
      ) {
        skipped++
        continue
      }
      batchProgress.value = { done: completed.length, total: queue.length, name: model.name }
      toast.loading(
        t('openCode.batchProgress', { ...batchProgress.value, done: completed.length + 1 }),
        { id: batchToast }
      )
      try {
        const result = await getApi().openCodeFree.test(model.id, {
          confirmInference: true,
          allowPaid: model.price === 'paid' && allowPaid,
          credentialId,
          expectedCost: model.cost ? { ...model.cost } : undefined,
          expectedService: model.service ?? 'zen'
        })
        if (disposed) break
        state.value = result
        if (result.error === 'REQUEST_CANCELLED') {
          batchCancelled = true
          break
        }
        completed.push(model.id)
        batchProgress.value.done = completed.length
        if (
          [
            'INVALID_API_KEY',
            'NOT_CONFIGURED',
            'PROVIDER_DISABLED',
            'SECURE_STORAGE_UNAVAILABLE',
            'RATE_LIMITED',
            'NETWORK_ERROR'
          ].includes(result.error ?? '')
        )
          break
      } catch {
        // IPC failures are not model results. Stop the queue and retain safe feedback.
        if (!disposed && !batchCancelled) toast.error(t('openCode.failed'))
        break
      }
    }
    if (!disposed) {
      await Promise.all([models.fetchList(), providers.fetchList()])
      const passed = completed.filter((id) => {
        const model = state.value?.models.find((item) => item.id === id)
        return model && !openCodeSelectionBlock(state.value, model)
      }).length
      const failed = completed.length - passed
      const remaining = Math.max(0, (state.value?.models.length ?? 0) - completed.length - skipped)
      const message = t(batchCancelled ? 'openCode.batchCancelled' : 'openCode.batchResult', {
        passed,
        failed,
        skipped,
        remaining
      })
      if (batchCancelled || failed || remaining)
        toast.warning(message, { id: batchToast, duration: 8000 })
      else toast.success(message, { id: batchToast, duration: 8000 })
    }
  } catch {
    if (!disposed) toast.error(t('openCode.failed'), { id: batchToast, duration: 5000 })
  } finally {
    // A pending cancel must settle before another operation can acquire the UI lock.
    await cancellation
    busy.value = false
    batchRunning.value = false
    batchToast = undefined
  }
}
function editCredential(profile?: OpenCodeCredential): void {
  revealGeneration++
  revealing.value = false
  editingId.value = profile?.id
  credentialName.value = profile?.name ?? `OpenCode ${credentials.value.length + 1}`
  credentialValue.value = ''
  revealed.value = false
  revealedStored.value = false
  dataConsent.value = Boolean(profile)
  credentialDialog.value = true
}
async function toggleReveal(): Promise<void> {
  if (revealed.value) {
    revealed.value = false
    if (revealedStored.value) credentialValue.value = ''
    revealedStored.value = false
    return
  }
  if (!credentialValue.value && editingId.value) {
    revealing.value = true
    const generation = ++revealGeneration
    const id = editingId.value
    try {
      const value = await getApi().openCodeFree.revealCredential(id)
      // A closed or changed dialog must not receive a late credential response.
      if (!credentialDialog.value || generation !== revealGeneration || id !== editingId.value)
        return
      credentialValue.value = value
      revealedStored.value = true
    } catch {
      if (generation === revealGeneration) toast.error(t('openCode.failed'))
      return
    } finally {
      if (generation === revealGeneration) revealing.value = false
    }
  }
  revealed.value = true
}
async function saveCredential(): Promise<void> {
  const replacement =
    !revealedStored.value && credentialValue.value ? credentialValue.value : undefined
  const refreshActive =
    !state.value?.activeCredentialId ||
    (editingId.value === state.value.activeCredentialId && Boolean(replacement))
  const form = {
    ...(editingId.value ? { id: editingId.value } : {}),
    name: credentialName.value,
    ...(replacement ? { apiKey: replacement } : {}),
    consent: true as const
  }
  credentialValue.value = ''
  revealed.value = false
  revealedStored.value = false
  await run(
    async () => {
      state.value = await getApi().openCodeFree.saveCredential(form)
      credentialDialog.value = false
      return refreshActive ? getApi().openCodeFree.refresh() : state.value
    },
    refreshActive ? 'refresh' : undefined
  )
}
async function showCredential(profile: OpenCodeCredential): Promise<void> {
  editCredential(profile)
  await toggleReveal()
}
function blockReason(model: OpenCodeModel): string | null {
  return openCodeVerificationBlock(state.value, model)
}
function showModelBlock(model: OpenCodeModel, code: string): void {
  toast.warning(t(`openCode.errors.${code}`, t('openCode.notAvailable')), {
    description: model.name,
    duration: 5000
  })
}
async function selectModel(model: OpenCodeModel): Promise<void> {
  if (busy.value) return
  const reason = openCodeSelectionBlock(state.value, model)
  if (reason) return showModelBlock(model, reason)
  await run(() => getApi().openCodeFree.select(model.id))
}
function beginVerification(model: OpenCodeModel): void {
  if (busy.value) return
  const reason = blockReason(model)
  if (reason) return showModelBlock(model, reason)
  enableAfterVerification.value = false
  verifyTarget.value = model
  paidPermission.value = false
  verifyDialog.value = true
}
async function performVerification(id: string, allowPaid: boolean, enable: boolean): Promise<void> {
  await run(
    async () => {
      const modelBefore = state.value?.models.find((model) => model.id === id)
      const options: OpenCodeTestOptions = {
        confirmInference: true,
        allowPaid,
        credentialId: state.value?.activeCredentialId ?? undefined,
        expectedCost: modelBefore?.cost ? { ...modelBefore.cost } : undefined,
        expectedService: modelBefore?.service ?? 'zen'
      }
      const result = await getApi().openCodeFree.test(id, options)
      state.value = result
      const model = result.models.find((item) => item.id === id)
      if (enable && !result.error && model && !openCodeSelectionBlock(result, model)) {
        return enableWorkspaceModel(id)
      }
      return result
    },
    { modelId: id }
  )
}
async function confirmVerification(): Promise<void> {
  if (!verifyTarget.value || (verifyTarget.value.price === 'paid' && !paidPermission.value)) return
  const id = verifyTarget.value.id
  const allowPaid = paidPermission.value
  const enable = enableAfterVerification.value
  verifyDialog.value = false
  await performVerification(id, allowPaid, enable)
}
function confirmDelete(profile: OpenCodeCredential): void {
  deleteTarget.value = profile
  deleteDialog.value = true
}
async function removeCredential(): Promise<void> {
  if (!deleteTarget.value) return
  const id = deleteTarget.value.id
  deleteDialog.value = false
  await run(() => getApi().openCodeFree.deleteCredential(id))
}
watch(credentialDialog, (open) => {
  if (!open) {
    revealGeneration++
    revealing.value = false
    credentialValue.value = ''
    revealed.value = false
    revealedStored.value = false
  }
})
onBeforeUnmount(() => {
  disposed = true
  if (batchRunning.value) {
    void cancelOperation()
    if (batchToast !== undefined) toast.dismiss(batchToast)
  }
  revealGeneration++
  credentialValue.value = ''
})
onMounted(async () => {
  try {
    state.value = await getApi().openCodeFree.state()
    if (state.value.hasCredential && state.value.enabled) {
      await run(() => getApi().openCodeFree.refresh())
    }
  } catch {
    toast.error(t('openCode.failed'))
  }
})
</script>

<template>
  <section
    data-testid="opencode-free-panel"
    class="flex h-full min-h-0 flex-col gap-4 overflow-hidden text-[12px] text-[var(--text-primary)]"
  >
    <header class="flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-[15px] font-semibold">OpenCode</h2>
        <p class="mt-1 text-[var(--text-secondary)]">{{ t('openCode.inference') }}</p>
      </div>
      <div
        data-testid="opencode-header-actions"
        class="ml-auto flex flex-wrap items-center justify-end gap-3"
      >
        <div
          class="flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] text-[var(--text-secondary)]"
          :title="t('openCode.workspaceHint')"
        >
          <Switch
            :model-value="state?.showInWorkspace === true"
            :disabled="busy || !state?.hasCredential"
            :label="t('openCode.workspaceVisibility')"
            @update:model-value="setWorkspaceVisibility($event)"
          />
          <span>{{ t('openCode.workspaceVisibility') }}</span>
        </div>
        <Button size="sm" variant="secondary" @click="getApi().openCodeFree.docs()">{{
          t('openCode.docs')
        }}</Button>
        <Button size="sm" variant="secondary" @click="getApi().openCodeFree.keys()">{{
          t('openCode.keys')
        }}</Button>
      </div>
    </header>
    <p
      class="shrink-0 rounded-[var(--radius-md)] bg-[var(--bg-surface-raised)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]"
    >
      {{ t('openCode.notice') }}
    </p>
    <div
      class="grid min-h-0 flex-1 grid-rows-[minmax(100px,0.4fr)_minmax(0,1fr)] gap-4 md:grid-cols-[230px_minmax(0,1fr)] md:grid-rows-1"
    >
      <aside
        class="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      >
        <div
          class="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] p-3"
        >
          <h3 class="font-medium">{{ t('openCode.credentials') }}</h3>
          <Button size="sm" variant="secondary" :disabled="busy" @click="editCredential()"
            ><Plus class="size-3.5" />{{ t('openCode.addKey') }}</Button
          >
        </div>
        <div
          data-testid="opencode-credentials-scroll"
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <p v-if="!credentials.length" class="p-4 text-[var(--text-tertiary)]">
            {{ t('openCode.noKeys') }}
          </p>
          <div
            v-for="profile in credentials"
            :key="profile.id"
            :data-testid="`opencode-credential-${profile.id}`"
            class="border-b border-[var(--border-subtle)] p-3 last:border-0"
            :class="profile.id === state?.activeCredentialId ? 'bg-[var(--bg-hover)]' : ''"
          >
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate font-medium">{{ profile.name }}</span
              ><span
                v-if="profile.id === state?.activeCredentialId"
                class="text-[10px] text-[var(--accent)]"
                >{{ t(state?.enabled ? 'openCode.current' : 'openCode.keyPaused') }}</span
              >
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                :disabled="busy"
                @click="useCredential(profile)"
                >{{
                  t(
                    profile.id === state?.activeCredentialId
                      ? state?.enabled
                        ? 'openCode.pauseKey'
                        : 'openCode.resumeKey'
                      : 'openCode.useKey'
                  )
                }}</Button
              >
              <button
                type="button"
                class="rounded p-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-40"
                :disabled="busy"
                :aria-label="`${t('openCode.show')} ${profile.name}`"
                @click="showCredential(profile)"
              >
                <Eye class="size-3.5" />
              </button>
              <button
                type="button"
                class="rounded p-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-40"
                :disabled="busy"
                :aria-label="`${t('openCode.editKey')} ${profile.name}`"
                @click="editCredential(profile)"
              >
                <Pencil class="size-3.5" />
              </button>
              <button
                type="button"
                class="rounded p-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-40"
                :disabled="busy"
                :aria-label="`${t('openCode.remove')} ${profile.name}`"
                @click="confirmDelete(profile)"
              >
                <Trash2 class="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </aside>
      <div
        class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      >
        <div class="shrink-0 space-y-3 border-b border-[var(--border-subtle)] p-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="font-medium">{{ t('openCode.modelAccess') }}</h3>
              <p class="mt-1 text-[11px] text-[var(--text-secondary)]">
                {{ activeCredential?.name ?? t('openCode.errors.NOT_CONFIGURED') }}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <div data-testid="opencode-more-actions">
                <DropdownMenuRoot v-model:open="moreActionsOpen" :modal="false">
                  <DropdownMenuTrigger as-child>
                    <Button size="sm" variant="secondary">{{ t('openCode.moreActions') }}</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent
                      align="end"
                      :side-offset="4"
                      class="z-50 min-w-[140px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] p-1 shadow-lg"
                    >
                      <DropdownMenuItem
                        as-child
                        :disabled="busy || !state?.hasCredential"
                        @select="runDiagnostic('connection')"
                      >
                        <Button
                          size="sm"
                          variant="ghost"
                          class="w-full justify-start"
                          :disabled="busy || !state?.hasCredential"
                          >{{ t('openCode.test') }}</Button
                        >
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        as-child
                        :disabled="busy"
                        @select="runDiagnostic('refresh')"
                      >
                        <Button
                          size="sm"
                          variant="ghost"
                          class="w-full justify-start"
                          :disabled="busy"
                          >{{ t('openCode.refresh') }}</Button
                        >
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenuRoot>
              </div>
              <Button
                size="sm"
                variant="secondary"
                :disabled="busy || !state?.enabled || !state?.hasCredential || !knownModels.length"
                @click="beginBatchVerification"
                >{{ t('openCode.verifyAll') }}</Button
              >
              <Button v-if="busy" size="sm" variant="secondary" @click="cancelOperation">{{
                t('openCode.cancel')
              }}</Button>
            </div>
          </div>
          <p
            v-if="batchRunning"
            role="status"
            aria-live="polite"
            class="text-[11px] text-[var(--text-secondary)]"
          >
            {{ t('openCode.batchProgress', batchProgress) }}
          </p>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex gap-1">
              <Button
                v-for="value in ['all', 'free', 'paid'] as const"
                :key="value"
                size="sm"
                :variant="filter === value ? 'primary' : 'secondary'"
                :aria-pressed="filter === value"
                @click="filter = value"
                >{{
                  value === 'all' ? t('openCode.allModels') : t(`openCode.values.${value}`)
                }}</Button
              >
            </div>
            <Input
              v-model="search"
              type="search"
              :placeholder="t('openCode.searchModels')"
              :aria-label="t('openCode.searchModels')"
            />
          </div>
        </div>
        <div
          data-testid="opencode-models-scroll"
          class="min-h-0 flex-1 overflow-auto overscroll-contain"
        >
          <table class="w-full min-w-[800px] text-left text-[11.5px]">
            <thead
              class="sticky top-0 z-20 whitespace-nowrap bg-[var(--bg-surface)] text-[var(--text-tertiary)]"
            >
              <tr class="border-b border-[var(--border-subtle)]">
                <th class="p-3">{{ t('openCode.model') }}</th>
                <th class="p-3">{{ t('openCode.price') }}</th>
                <th class="p-3">{{ t('openCode.status') }}</th>
                <th class="p-3">{{ t('openCode.context') }}</th>
                <th class="sticky right-0 z-10 min-w-[180px] bg-[var(--bg-surface)] p-3 text-right">
                  {{ t('openCode.actions') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="model in visibleModels"
                :key="model.id"
                :data-testid="`opencode-model-${model.id}`"
                class="border-b border-[var(--border-subtle)] last:border-0"
              >
                <td class="min-w-[180px] p-3">
                  <span class="font-medium">{{ model.name }}</span>
                  <span class="ml-2 text-[10px] text-[var(--text-tertiary)]">{{
                    model.service === 'go' ? 'Go' : 'Zen'
                  }}</span>
                  <div class="mt-1 text-[10px] text-[var(--text-tertiary)]">{{ model.id }}</div>
                  <div
                    data-testid="opencode-workspace-model-toggle"
                    class="mt-2 flex items-center gap-2 whitespace-nowrap text-[10px] text-[var(--text-tertiary)]"
                  >
                    <Switch
                      :model-value="state?.workspaceModelIds?.includes(model.id) === true"
                      :disabled="busy || !state?.hasCredential"
                      :label="t('openCode.showModel', { name: model.name })"
                      @update:model-value="toggleWorkspaceModel(model.id, $event)"
                    />
                    <span>{{ t('openCode.workspaceModels') }}</span>
                  </div>
                </td>
                <td class="min-w-[100px] whitespace-nowrap p-3">
                  {{ t(`openCode.values.${model.price}`) }}
                  <div
                    v-if="model.cost"
                    class="mt-1 whitespace-nowrap text-[10px] text-[var(--text-tertiary)]"
                  >
                    ${{ model.cost.input }} / ${{ model.cost.output }}
                  </div>
                </td>
                <td class="min-w-[180px] p-3">
                  <span
                    :class="
                      model.status === 'restricted' || model.status === 'failed'
                        ? 'text-[var(--warning)]'
                        : ''
                    "
                    >{{ t(`openCode.values.${model.status}`) }}</span
                  >
                  <div
                    v-if="model.errorCode"
                    class="mt-1 max-w-[180px] text-[10px] text-[var(--text-tertiary)]"
                  >
                    {{ t(`openCode.errors.${model.errorCode}`, model.errorCode) }}
                  </div>
                  <div class="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    <div class="whitespace-nowrap">
                      {{ t('openCode.streaming') }}: {{ t(`openCode.values.${model.streaming}`) }}
                    </div>
                    <div class="whitespace-nowrap">
                      {{ t('openCode.tools') }}: {{ t(`openCode.values.${model.tools}`) }}
                    </div>
                  </div>
                </td>
                <td class="min-w-[155px] p-3">
                  <span class="whitespace-nowrap"
                    >{{ model.contextWindow?.toLocaleString() ?? '—' }} /
                    {{ model.maxTokens?.toLocaleString() ?? '—' }}</span
                  >
                  <div class="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    {{ model.input?.includes('image') ? t('openCode.vision') : '' }}
                    {{ model.reasoning ? t('openCode.reasoning') : '' }}
                  </div>
                </td>
                <td
                  class="sticky right-0 z-10 min-w-[180px] whitespace-nowrap bg-[var(--bg-surface)] p-3 text-right"
                >
                  <div class="flex flex-nowrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      :disabled="busy"
                      @click="beginVerification(model)"
                      >{{
                        blockReason(model) ? t('openCode.viewReason') : t('openCode.verifyShort')
                      }}</Button
                    ><Button
                      size="sm"
                      variant="secondary"
                      :disabled="busy"
                      @click="selectModel(model)"
                      >{{
                        models.active.providerKey === 'opencode-free' &&
                        models.active.modelId === model.id
                          ? t('openCode.selected')
                          : t('openCode.select')
                      }}</Button
                    >
                  </div>
                </td>
              </tr>
              <tr v-if="!visibleModels.length">
                <td colspan="5" class="p-8 text-center text-[var(--text-tertiary)]">
                  {{ t('openCode.noModels') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer
          class="flex shrink-0 flex-wrap justify-between gap-2 border-t border-[var(--border-subtle)] p-3 text-[10px] text-[var(--text-tertiary)]"
        >
          <span
            >{{ t('openCode.checked') }}:
            {{ state?.refreshedAt ? new Date(state.refreshedAt).toLocaleString() : '—' }}</span
          ><span v-if="hiddenCount">{{ t('openCode.hiddenModels', { count: hiddenCount }) }}</span
          ><span>{{ t('openCode.perMillion') }}</span>
        </footer>
      </div>
    </div>
    <Dialog
      v-model:open="credentialDialog"
      :title="editingId ? t('openCode.editKey') : t('openCode.addKey')"
      wide
    >
      <div class="space-y-4">
        <Input
          v-model="credentialName"
          :label="t('openCode.keyName')"
          :aria-label="t('openCode.keyName')"
          :disabled="busy"
          maxlength="80"
        />
        <Input
          :model-value="credentialValue"
          :label="t('openCode.credential')"
          :aria-label="t('openCode.credential')"
          :placeholder="editingId ? t('openCode.saved') : t('openCode.credential')"
          revealable
          :revealed="revealed"
          :reveal-loading="revealing || busy"
          :reveal-label="t('openCode.show')"
          :hide-label="t('openCode.hide')"
          autocomplete="off"
          :disabled="busy"
          @update:model-value="
            (value) => {
              credentialValue = value
              revealedStored = false
            }
          "
          @reveal-toggle="toggleReveal"
        />
        <div class="flex items-center gap-2">
          <Switch v-model="dataConsent" :disabled="busy" :label="t('openCode.consent')" /><span>{{
            t('openCode.consent')
          }}</span>
        </div>
      </div>
      <template #footer
        ><Button variant="secondary" :disabled="busy" @click="credentialDialog = false">{{
          t('openCode.cancel')
        }}</Button
        ><Button
          :disabled="
            busy ||
            revealing ||
            !dataConsent ||
            !credentialName.trim() ||
            (!editingId && !credentialValue.trim())
          "
          @click="saveCredential"
          >{{ t('openCode.save') }}</Button
        ></template
      >
    </Dialog>
    <Dialog
      v-model:open="deleteDialog"
      :title="t('openCode.remove')"
      :description="t('openCode.deleteConfirm', { name: deleteTarget?.name })"
    >
      <template #footer
        ><Button variant="secondary" @click="deleteDialog = false">{{
          t('openCode.cancel')
        }}</Button
        ><Button @click="removeCredential">{{ t('openCode.remove') }}</Button></template
      >
    </Dialog>
    <Dialog
      v-model:open="verifyDialog"
      :title="t('openCode.verifyModel', { name: verifyTarget?.name })"
      wide
    >
      <div class="space-y-3">
        <p>{{ t('openCode.verifyNotice') }}</p>
        <p>
          {{ t('openCode.price') }}:
          {{ verifyTarget ? t(`openCode.values.${verifyTarget.price}`) : '' }}
          <span v-if="verifyTarget?.cost"
            >${{ verifyTarget.cost.input }} / ${{ verifyTarget.cost.output }} ·
            {{ t('openCode.perMillion') }}</span
          >
        </p>
        <div v-if="verifyTarget?.price === 'paid'" class="flex items-center gap-2">
          <Switch v-model="paidPermission" :label="t('openCode.paidConsent')" /><span>{{
            t('openCode.paidConsent')
          }}</span>
        </div>
      </div>
      <template #footer
        ><Button variant="secondary" @click="verifyDialog = false">{{
          t('openCode.cancel')
        }}</Button
        ><Button
          :disabled="verifyTarget?.price === 'paid' && !paidPermission"
          @click="confirmVerification"
          >{{ t('openCode.confirmVerify') }}</Button
        ></template
      >
    </Dialog>
    <Dialog v-model:open="batchDialog" :title="t('openCode.verifyAll')" wide>
      <div class="space-y-3">
        <p>{{ t('openCode.batchNotice') }}</p>
        <p>
          {{
            t('openCode.batchPlan', {
              count: batchCandidates.length,
              paid: batchPaidCount,
              skipped: batchSkipped
            })
          }}
        </p>
        <ul
          v-if="batchSkippedReasons.length"
          class="space-y-1 text-[12px] text-[var(--text-secondary)]"
        >
          <li v-for="reason in batchSkippedReasons" :key="reason.code">
            {{ t(`openCode.errors.${reason.code}`, t('openCode.notAvailable')) }} ·
            {{ reason.count }}
          </li>
        </ul>
        <p v-if="!batchCandidates.length" class="text-[var(--text-secondary)]">
          {{ t('openCode.batchEmpty') }}
        </p>
        <ul class="space-y-2 text-[12px]">
          <li
            v-for="model in batchCandidates"
            :key="model.id"
            class="flex flex-wrap justify-between gap-2"
          >
            <span>{{ model.name }}</span>
            <span class="text-[var(--text-secondary)]"
              >{{ t(`openCode.values.${model.price}`) }} · ${{ model.cost?.input }} / ${{
                model.cost?.output
              }}</span
            >
          </li>
        </ul>
        <p v-if="batchCandidates.length" class="text-[11px] text-[var(--text-tertiary)]">
          {{ t('openCode.perMillion') }}
        </p>
        <div v-if="batchPaidCount" class="flex items-center gap-2">
          <Switch
            v-model="batchPaidPermission"
            :label="t('openCode.batchPaidConsent', { count: batchPaidCount })"
          />
          <span>{{ t('openCode.batchPaidConsent', { count: batchPaidCount }) }}</span>
        </div>
      </div>
      <template #footer>
        <Button variant="secondary" @click="batchDialog = false">{{ t('openCode.cancel') }}</Button>
        <Button
          :disabled="!batchCandidates.length || (batchPaidCount > 0 && !batchPaidPermission)"
          @click="confirmBatchVerification"
          >{{ t('openCode.confirmVerify') }}</Button
        >
      </template>
    </Dialog>
  </section>
</template>
