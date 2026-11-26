<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useChatViewActive } from '@renderer/composables/chat-view-activity'
import MessageHistory from './MessageHistory.vue'
import FullHistoryDialog from './FullHistoryDialog.vue'
import ConversationWidthHandles from './ConversationWidthHandles.vue'
import UniversalOrigin from '@renderer/components/universal/UniversalOrigin.vue'
import ChatComposer from './ChatComposer.vue'
import ConversationMinimap from './ConversationMinimap.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Gauge,
  History,
  MessageSquare,
  ShieldAlert
} from '@lucide/vue'
import Button from '@renderer/components/ui/Button.vue'
import { useAgentStore } from '@renderer/stores/agent'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useModelsStore } from '@renderer/stores/models'
import { useSettingsStore } from '@renderer/stores/settings'
import { useHarnessStore } from '@renderer/stores/harness'
import { useSkillsStore } from '@renderer/stores/skills'
import { buildMessageFileChanges } from './message-file-changes'
import { resolveSkillMention } from './skill-invocation'
import {
  agentModeDirective,
  normalizeAgentMode,
  toolPresetForAgentMode,
  type AgentMode
} from '@shared/workspace/agent-mode'
import { usePermissionStore } from '@renderer/stores/permission'
import type { AgentImageAttachment, SessionDetail } from '@shared/types/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'
import { useCompletionSound } from '@renderer/composables/useCompletionSound'
import { useStickToBottom } from '@renderer/composables/useStickToBottom'
import { normalizeAssistantName, normalizeUserName } from '@shared/constants/chat-participants'
import { hasRenderableMessageContent } from './message-visibility'
import type { AgentMessage } from '@shared/types/workspace'
import type { MessageFileChanges } from './message-file-changes'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'

interface ComposerImageModelTarget {
  providerKey: string
  modelId: string
}

const { locale, t } = useI18n()
const active = useChatViewActive()
const agent = useAgentStore()
const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const models = useModelsStore()
const settings = useSettingsStore()
const harness = useHarnessStore()
const skills = useSkillsStore()
const permission = usePermissionStore()
const permissionRequests = computed(() => permission.requestsFor(sessions.currentId))
const scroller = ref<HTMLElement | null>(null)
const scrollContent = ref<HTMLElement | null>(null)
const composer = ref<InstanceType<typeof ChatComposer> | null>(null)
const statsOpen = ref(false)
const fullHistoryOpen = ref(false)
const fullHistoryLoading = ref(false)
const fullHistoryDetail = ref<SessionDetail | null>(null)
let fullHistoryGeneration = 0
const copiedField = ref<'file' | 'id' | null>(null)
const completionSound = useCompletionSound()
const {
  hasOverflow: hasScrollOverflow,
  atTop: atScrollTop,
  atBottom: atScrollBottom,
  onScroll: onScrollerScroll,
  onWheel: onScrollerWheel,
  onTouchStart: onScrollerTouchStart,
  onTouchMove: onScrollerTouchMove,
  onPointerDown: onScrollerPointerDown,
  onKeyDown: onScrollerKeyDown,
  scrollToEdge,
  stick: stickToLatest,
  release: releaseFollow,
  scheduleSync: scheduleScrollSync,
  bind: bindChatScroll,
  unbind: unbindChatScroll
} = useStickToBottom(scroller, scrollContent)

function onTranscriptClick(event: MouseEvent) {
  // Opening saved activity is an explicit reading action; keep its row in view
  // when the disclosure changes the transcript height.
  if ((event.target as HTMLElement | null)?.closest('summary')) releaseFollow()
}

function focusComposer() {
  composer.value?.focus()
}

defineExpose({ focusComposer })

const stats = computed(() => agent.sessionStats)
const followUpQueue = computed(() =>
  harness.state?.sessionId === sessions.currentId ? harness.state?.queue.followUp : undefined
)
const contextUsage = computed(() => agent.state?.contextUsage ?? null)
const chatContentMaxWidth = computed(() => `${settings.settings?.chatContentMaxWidth ?? 760}px`)
const contextPercent = computed(() => {
  const percent = contextUsage.value?.percent
  return typeof percent === 'number' && Number.isFinite(percent) ? percent : null
})
const contextPercentLabel = computed(() =>
  contextPercent.value === null
    ? ''
    : `${contextPercent.value.toLocaleString(locale.value, { maximumFractionDigits: 1 })}%`
)
const showContextWarning = computed(
  () => contextPercent.value !== null && contextPercent.value > 80
)
const canViewFullHistory = computed(() =>
  Boolean(sessions.currentId && !sessions.current?.transient)
)
const replyError = computed(() => inspectRuntimeError(agent.error))
const replyTruncated = computed(() => replyError.value.kind === 'truncated')
const replyRateLimited = computed(() => replyError.value.kind === 'rate_limit')
const replyAborted = computed(() => replyError.value.kind === 'aborted')
const compaction = computed(() => agent.state?.compaction ?? null)
const compactionLabel = computed(() => {
  const status = compaction.value
  if (!status) return null
  if (status.phase === 'compacting' || agent.state?.isCompacting)
    return String(t('workspace.compactingNow'))
  if (status.phase === 'failed' && status.error) return status.error
  if (status.phase === 'succeeded' && status.tokensBefore != null && status.tokensAfter != null) {
    return String(
      t('workspace.compactDoneRange', {
        before: status.tokensBefore.toLocaleString(),
        after: status.tokensAfter.toLocaleString()
      })
    )
  }
  if (status.smartEnabled && status.threshold != null) {
    return `${String(t('workspace.compactionThreshold'))}: ${compactNumber(status.threshold)}`
  }
  return null
})
const userName = computed(() => normalizeUserName(settings.settings?.userName))
const assistantName = computed(() => normalizeAssistantName(settings.settings?.assistantName))

const fileChangesByEntryId = computed(() =>
  buildMessageFileChanges(agent.messages, agent.entryIds, harness.runs, harness.artifacts)
)
interface DisplayMessage {
  key: string
  message: AgentMessage
  entryId?: string
  fileChanges?: MessageFileChanges
  streaming: boolean
}

const persistedMessages = computed<DisplayMessage[]>((previous) => {
  if (!active.value) return previous ?? []
  return agent.messages.flatMap((message, index): DisplayMessage[] => {
    const entryId = agent.entryIds[index]
    const fileChanges = entryId ? fileChangesByEntryId.value.get(entryId) : undefined
    if (!hasRenderableMessageContent(message) && !fileChanges) return []
    return [
      {
        key: entryId ?? `message-${index}`,
        message,
        entryId,
        fileChanges,
        streaming: false
      }
    ]
  })
})
const liveMessage = computed(() => {
  if (!active.value) return null
  const live = agent.streaming.streamingMessage
  return live && hasRenderableMessageContent(live) ? live : null
})

watch([persistedMessages, liveMessage, () => agent.isBusy(sessions.currentId)], async () => {
  if (!active.value) return
  await nextTick()
  if (active.value) scheduleScrollSync()
})

let scrollBindingGeneration = 0
watch(
  active,
  async (visible) => {
    const generation = ++scrollBindingGeneration
    unbindChatScroll()
    if (!visible) {
      fullHistoryGeneration++
      fullHistoryOpen.value = false
      fullHistoryDetail.value = null
      fullHistoryLoading.value = false
      return
    }
    await nextTick()
    if (active.value && generation === scrollBindingGeneration) bindChatScroll()
  },
  { immediate: true, flush: 'post' }
)

onBeforeUnmount(() => {
  scrollBindingGeneration++
  unbindChatScroll()
})

watch(
  () => agent.completionCount,
  (next, previous) => {
    if (next > previous) void completionSound.play()
  }
)

watch(
  () => settings.settings?.petSound,
  (enabled) => completionSound.setEnabled(enabled ?? false),
  { immediate: true }
)

watch(contextPercent, (percent) => {
  if (percent === null) statsOpen.value = false
})

function toggleCompletionSound() {
  completionSound.toggle()
  void settings
    .patch({ petSound: completionSound.enabled.value })
    .catch((error) => toast.error((error as Error).message))
}

watch(
  () => sessions.currentId,
  async () => {
    statsOpen.value = false
    fullHistoryGeneration++
    fullHistoryOpen.value = false
    fullHistoryDetail.value = null
    copiedField.value = null
    stickToLatest()
    await nextTick()
    if (active.value) scrollToEdge('bottom', 'auto')
  }
)

const pendingDrafts = ref(new Set<string>())
const submitting = computed(() => pendingDrafts.value.has(workspace.draftKey))

async function submitDraft(send: () => Promise<void>) {
  const key = workspace.draftKey
  if (pendingDrafts.value.has(key)) return
  pendingDrafts.value.add(key)
  try {
    await send()
  } finally {
    pendingDrafts.value.delete(key)
  }
}

async function onSend(imageModel: ComposerImageModelTarget | null = null, mode?: AgentMode) {
  await submitDraft(() => sendDraft(imageModel, mode))
}

async function sendDraft(imageModel: ComposerImageModelTarget | null, mode?: AgentMode) {
  const text = workspace.draft.trim()
  const selectedSkillName = imageModel ? null : workspace.draftSkill
  const skillInvocation = imageModel
    ? null
    : selectedSkillName
      ? {
          name: selectedSkillName,
          prompt: text,
          runtimeText: text ? `/skill:${selectedSkillName} ${text}` : `/skill:${selectedSkillName}`
        }
      : resolveSkillMention(
          text,
          skills.skills.filter((skill) => skill.isValid).map((skill) => skill.name)
        )
  const directive = agentModeDirective(normalizeAgentMode(mode))
  const runtimeText = [directive, skillInvocation?.runtimeText ?? text].filter(Boolean).join('\n\n')
  const displayText = selectedSkillName
    ? text
      ? `@${selectedSkillName} ${text}`
      : `@${selectedSkillName}`
    : text
  const draftKey = workspace.draftKey
  const images: AgentImageAttachment[] = workspace.draftImages.map(({ data, mimeType }) => ({
    type: 'image',
    data,
    mimeType
  }))
  if (!displayText && !images.length) return
  stickToLatest()
  const selectedMode = normalizeAgentMode(mode)
  const preset = agent.activePreset()
  const effectivePreset = toolPresetForAgentMode(selectedMode, preset)
  const permissionSessionId = sessions.currentId
  const cwd = workspace.currentCwd
  const permissionMode = permission.modeFor(permissionSessionId)
  await completionSound.unlock()
  const sessionId = imageModel
    ? await agent.sendImage(permissionSessionId, cwd, text, effectivePreset, imageModel, images)
    : await agent.send(
        permissionSessionId,
        cwd,
        runtimeText,
        effectivePreset,
        images,
        displayText,
        permissionMode
      )
  if (agent.error) return
  workspace.clearDraft(draftKey)
  if (sessionId && !permissionSessionId) permission.setMode(sessionId, permissionMode)
  if (sessionId && sessionId !== sessions.currentId && workspace.draftKey === draftKey) {
    workspace.consumeDraftSession()
    // Persist the selected chat before slower workspace/runtime restoration.
    // A reload immediately after the first reply must reopen this session.
    workspace.ensureChatTab(sessionId, displayText.slice(0, 32) || sessionId)
  }
}

async function onAbort() {
  await agent.abort(sessions.currentId)
}

async function viewFullHistory() {
  const sessionId = sessions.currentId
  if (!sessionId || sessions.current?.transient) return
  const generation = ++fullHistoryGeneration
  fullHistoryOpen.value = true
  fullHistoryLoading.value = true
  fullHistoryDetail.value = null
  try {
    const detail = await callApi(() => getApi().sessions.viewFullHistory(sessionId))
    if (generation === fullHistoryGeneration) fullHistoryDetail.value = detail
  } catch (error) {
    if (generation === fullHistoryGeneration) {
      fullHistoryOpen.value = false
      toast.error((error as Error).message)
    }
  } finally {
    if (generation === fullHistoryGeneration) fullHistoryLoading.value = false
  }
}

async function copyStat(field: 'file' | 'id', value: string) {
  try {
    await callApi(() => getApi().system.copyText(value))
  } catch {
    await navigator.clipboard.writeText(value)
  }
  copiedField.value = field
  window.setTimeout(() => {
    if (copiedField.value === field) copiedField.value = null
  }, 1500)
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}k`
  return value.toLocaleString(locale.value)
}

function duration(value: number): string {
  const seconds = Math.floor(value / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${rest}s`
  return `${rest}s`
}
</script>

<template>
  <div
    data-testid="chat-window"
    data-chat-surface
    class="chat-window flex h-full min-h-0 min-w-0 flex-col"
    :style="{ '--chat-content-max-width': chatContentMaxWidth }"
  >
    <UniversalOrigin :session-id="sessions.currentId" />
    <div class="relative min-h-0 flex-1">
      <div
        ref="scroller"
        data-testid="chat-scroller"
        class="chat-scroller h-full min-h-0 overflow-y-auto px-4 py-3 min-[1080px]:pr-[132px]"
        @scroll.passive="onScrollerScroll"
        @wheel.passive="onScrollerWheel"
        @touchstart.passive="onScrollerTouchStart"
        @touchmove.passive="onScrollerTouchMove"
        @pointerdown="onScrollerPointerDown"
        @keydown="onScrollerKeyDown"
      >
        <div
          ref="scrollContent"
          data-chat-band
          class="chat-scroll-content min-w-0"
          @click.capture="onTranscriptClick"
        >
          <EmptyState
            v-if="
              !persistedMessages.length &&
              !liveMessage &&
              !submitting &&
              !agent.isBusy(sessions.currentId)
            "
            :title="$t('workspace.emptyChat')"
            :description="$t('workspace.emptyChatHint')"
            :icon="MessageSquare"
          />
          <MessageHistory
            :key="sessions.currentId ?? 'new-chat'"
            :items="persistedMessages"
            :runs="harness.runs"
            :user-name="userName"
            :assistant-name="assistantName"
            :running="active && (submitting || agent.isBusy(sessions.currentId))"
            :live-message="liveMessage"
          />
          <div
            v-if="
              (agent.error && !replyAborted) ||
              compaction?.phase === 'compacting' ||
              agent.state?.isCompacting
            "
            role="alert"
            class="mt-2 text-[12px] [overflow-wrap:anywhere]"
          >
            <p
              v-if="agent.state?.isCompacting || compaction?.phase === 'compacting'"
              class="text-[var(--text-secondary)]"
              data-testid="compacting-status"
            >
              {{ $t('workspace.compactingNow') }}
            </p>
            <p v-else-if="agent.error && !replyAborted" class="text-[var(--danger)]">
              {{
                replyTruncated
                  ? $t('workspace.replyTruncated')
                  : replyRateLimited
                    ? $t('workspace.rateLimitRetry')
                    : agent.error
              }}
            </p>
          </div>
        </div>
      </div>
      <ConversationMinimap
        :target="active ? scroller : null"
        :messages="persistedMessages"
        @release-follow="releaseFollow"
      />
      <ConversationWidthHandles />
      <div
        v-if="hasScrollOverflow"
        data-testid="chat-scroll-controls"
        class="absolute bottom-3 right-4 z-20 flex flex-col gap-1 min-[1080px]:right-[120px]"
      >
        <button
          v-if="!atScrollTop"
          type="button"
          data-testid="chat-scroll-top"
          class="inline-flex size-7 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface-raised)]/95 text-[var(--text-secondary)] shadow-[var(--shadow-popover)] backdrop-blur transition-[color,background-color,border-color,transform] hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:scale-95 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          :title="$t('workspace.scrollToTop')"
          :aria-label="$t('workspace.scrollToTop')"
          @click="scrollToEdge('top')"
        >
          <ArrowUp aria-hidden="true" class="size-3.5" :stroke-width="1.9" />
        </button>
        <button
          v-if="!atScrollBottom"
          type="button"
          data-testid="chat-scroll-bottom"
          class="inline-flex size-7 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface-raised)]/95 text-[var(--text-secondary)] shadow-[var(--shadow-popover)] backdrop-blur transition-[color,background-color,border-color,transform] hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:scale-95 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          :title="$t('workspace.scrollToBottom')"
          :aria-label="$t('workspace.scrollToBottom')"
          @click="scrollToEdge('bottom')"
        >
          <ArrowDown aria-hidden="true" class="size-3.5" :stroke-width="1.9" />
        </button>
      </div>
      <Transition name="session-hud">
        <section
          v-if="statsOpen"
          :aria-label="$t('workspace.sessionInfo')"
          class="session-hud absolute inset-x-3 bottom-2 z-30 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-4 py-3 font-[family-name:var(--font-mono)] text-[11.5px] leading-5 shadow-[var(--shadow-popover)]"
        >
          <div class="session-hud-grid grid gap-x-6 gap-y-3">
            <section class="min-w-0">
              <h3 class="mb-1.5 font-semibold text-[var(--text-primary)]">
                {{ $t('workspace.sessionInfo') }}
              </h3>
              <div
                v-if="stats"
                class="grid grid-cols-[max-content_minmax(0,1fr)_24px] items-start gap-x-3 gap-y-1"
              >
                <template v-if="stats.sessionName">
                  <span class="text-[var(--text-tertiary)]">{{ $t('workspace.sessionName') }}</span>
                  <span class="col-span-2 break-words text-[var(--text-secondary)]">{{
                    stats.sessionName
                  }}</span>
                </template>
                <span class="text-[var(--text-tertiary)]">{{ $t('workspace.sessionFile') }}</span>
                <span class="break-all text-[var(--text-secondary)]">{{
                  stats.sessionFile || $t('workspace.inMemory')
                }}</span>
                <button
                  v-if="stats.sessionFile"
                  type="button"
                  class="inline-flex size-5 items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                  :title="$t('workspace.copyFile')"
                  @click="copyStat('file', stats.sessionFile)"
                >
                  <Check
                    v-if="copiedField === 'file'"
                    aria-hidden="true"
                    class="size-3 text-[var(--success)]"
                  />
                  <Copy v-else aria-hidden="true" class="size-3" />
                </button>
                <span class="text-[var(--text-tertiary)]">ID</span>
                <span class="break-all text-[var(--text-secondary)]">{{ stats.sessionId }}</span>
                <button
                  type="button"
                  class="inline-flex size-5 items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                  :title="$t('workspace.copyId')"
                  @click="copyStat('id', stats.sessionId)"
                >
                  <Check
                    v-if="copiedField === 'id'"
                    aria-hidden="true"
                    class="size-3 text-[var(--success)]"
                  />
                  <Copy v-else aria-hidden="true" class="size-3" />
                </button>
                <template v-if="stats.totalActiveMs">
                  <span class="text-[var(--text-tertiary)]">{{
                    $t('workspace.activeDuration')
                  }}</span>
                  <span class="col-span-2 text-[var(--text-secondary)]">{{
                    duration(stats.totalActiveMs)
                  }}</span>
                </template>
              </div>
            </section>
            <section v-if="stats" class="min-w-0">
              <h3 class="mb-1.5 font-semibold text-[var(--text-primary)]">
                {{ $t('workspace.messages') }}
              </h3>
              <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
                <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.messageUser') }}</dt>
                <dd>{{ stats.userMessages.toLocaleString(locale) }}</dd>
                <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.messageAssistant') }}</dt>
                <dd>{{ stats.assistantMessages.toLocaleString(locale) }}</dd>
                <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.toolCalls') }}</dt>
                <dd>{{ stats.toolCalls.toLocaleString(locale) }}</dd>
                <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.toolResults') }}</dt>
                <dd>{{ stats.toolResults.toLocaleString(locale) }}</dd>
                <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.total') }}</dt>
                <dd>{{ stats.totalMessages.toLocaleString(locale) }}</dd>
              </dl>
            </section>
            <section v-if="stats" class="min-w-0">
              <h3 class="mb-1.5 font-semibold text-[var(--text-primary)]">Token</h3>
              <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
                <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.tokenInput') }}</dt>
                <dd>{{ stats.tokens.input.toLocaleString(locale) }}</dd>
                <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.tokenOutput') }}</dt>
                <dd>{{ stats.tokens.output.toLocaleString(locale) }}</dd>
                <template v-if="stats.tokens.cacheRead">
                  <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.cacheRead') }}</dt>
                  <dd>{{ stats.tokens.cacheRead.toLocaleString(locale) }}</dd>
                </template>
                <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.total') }}</dt>
                <dd>{{ stats.tokens.total.toLocaleString(locale) }}</dd>
                <template v-if="contextUsage?.contextWindow && contextPercent !== null">
                  <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.context') }}</dt>
                  <dd>
                    {{ contextPercentLabel }} /
                    {{ compactNumber(contextUsage.contextWindow) }}
                  </dd>
                </template>
                <template v-if="compaction">
                  <dt class="text-[var(--text-tertiary)]">{{ $t('settings.smartCompaction') }}</dt>
                  <dd>
                    {{ compaction.smartEnabled ? $t('common.enabled') : $t('common.disabled') }}
                  </dd>
                  <template v-if="compaction.threshold != null">
                    <dt class="text-[var(--text-tertiary)]">
                      {{ $t('workspace.compactionThreshold') }}
                    </dt>
                    <dd>{{ compactNumber(compaction.threshold) }}</dd>
                  </template>
                  <template v-if="compactionLabel && compaction.phase !== 'idle'">
                    <dt class="text-[var(--text-tertiary)]">
                      {{ $t('workspace.autoCompaction') }}
                    </dt>
                    <dd class="max-w-[14rem] truncate" :title="compactionLabel">
                      {{ compactionLabel }}
                    </dd>
                  </template>
                </template>
              </dl>
            </section>
          </div>
        </section>
      </Transition>
    </div>
    <div
      v-for="request in permissionRequests"
      :key="request.requestId"
      data-testid="permission-card"
      class="composer-band mb-2 flex items-center gap-3 rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3.5 py-2.5 shadow-[var(--shadow-sm)]"
    >
      <ShieldAlert aria-hidden="true" class="size-4 shrink-0 text-[var(--accent)]" />
      <div class="min-w-0 flex-1">
        <p class="text-[12px] font-medium text-[var(--text-primary)]">
          {{ $t('workspace.permissionCardTitle') }}
        </p>
        <p
          class="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-secondary)]"
          :title="request.summary"
        >
          {{ request.toolName }} · {{ request.summary }}
        </p>
      </div>
      <Button variant="ghost" size="sm" @click="permission.declineRequest(request)">
        {{ $t('workspace.permissionDecline') }}
      </Button>
      <Button variant="primary" size="sm" @click="permission.acceptRequest(request)">
        {{ $t('workspace.permissionApprove') }}
      </Button>
    </div>
    <ChatComposer
      ref="composer"
      :sound-enabled="completionSound.enabled.value"
      :submitting="submitting"
      :follow-up-queue="followUpQueue"
      @send="onSend"
      @abort="onAbort"
      @toggle-sound="toggleCompletionSound"
      @unlock-audio="completionSound.unlock"
    >
      <template #session-actions>
        <button
          type="button"
          data-testid="composer-full-history"
          class="cockpit-control-button inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canViewFullHistory"
          :aria-label="$t('workspace.fullHistory')"
          :title="
            canViewFullHistory
              ? $t('workspace.fullHistory')
              : $t('workspace.fullHistoryUnavailable')
          "
          @click="viewFullHistory"
        >
          <History aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
        </button>
        <button
          v-if="contextPercent !== null"
          type="button"
          data-testid="composer-context-usage"
          class="composer-context-usage cockpit-control-button inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[11px] text-[var(--text-secondary)] tabular-nums transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          :class="statsOpen ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : ''"
          :aria-label="`${$t('workspace.sessionInfo')} ${contextPercentLabel}`"
          :title="$t('workspace.sessionInfo')"
          :aria-expanded="statsOpen"
          @click="statsOpen = !statsOpen"
        >
          <Gauge
            aria-hidden="true"
            class="size-3.5 shrink-0"
            :class="{ 'text-[var(--danger)]': showContextWarning }"
            :stroke-width="1.8"
          />
          <span>{{ contextPercentLabel }}</span>
        </button>
      </template>
    </ChatComposer>
    <div
      data-testid="chat-status-hud"
      class="chat-status-hud flex h-9 shrink-0 items-stretch border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] text-[var(--text-secondary)]"
    >
      <span class="flex min-w-0 items-center truncate px-3 text-[var(--text-tertiary)]">
        {{ models.active.providerKey }}/{{ models.active.modelId }} · {{ agent.thinkingLevel }}
      </span>
      <div
        v-if="stats?.tokens.input || stats?.tokens.output"
        class="ml-auto inline-flex shrink-0 items-center gap-2 border-l border-[var(--border-subtle)] px-3 tabular-nums"
      >
        <span v-if="stats?.tokens.input" class="inline-flex items-center gap-1">
          <ArrowUp aria-hidden="true" class="size-3" />{{ compactNumber(stats.tokens.input) }}
        </span>
        <span v-if="stats?.tokens.output" class="inline-flex items-center gap-1">
          <ArrowDown aria-hidden="true" class="size-3" />{{ compactNumber(stats.tokens.output) }}
        </span>
      </div>
    </div>
    <FullHistoryDialog
      v-model:open="fullHistoryOpen"
      :detail="fullHistoryDetail"
      :loading="fullHistoryLoading"
      :user-name="userName"
      :assistant-name="assistantName"
    />
  </div>
</template>

<style scoped>
.session-hud {
  container-type: inline-size;
  max-height: calc(100% - 1rem);
}

@container (min-width: 28rem) {
  .session-hud-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .session-hud-grid > :first-child {
    grid-column: span 2;
  }
}

@container (min-width: 44rem) {
  .session-hud-grid {
    grid-template-columns: minmax(0, 1.7fr) minmax(0, 0.65fr) minmax(0, 0.85fr);
  }
  .session-hud-grid > :first-child {
    grid-column: auto;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .session-hud-enter-active,
  .session-hud-leave-active {
    transition:
      opacity 150ms ease,
      transform 150ms ease;
  }

  .session-hud-enter-from,
  .session-hud-leave-to {
    opacity: 0;
    transform: translateY(8px);
  }
}

.chat-scroller {
  /*
   * Browser scroll anchoring fights stick-to-bottom: measuring an off-screen
   * message (content-visibility) shifts scrollTop and looks like the user
   * left the latest turn. We pin to the bottom ourselves while stuck.
   */
  overflow-anchor: none;
}

/*
 * Centered chat content band: transcript, empty state, and error line share
 * one preferred max width (also used by the composer and the resize handles).
 * The live used width is min(available, preferred), so a narrow window or
 * workspace split compresses the band without rewriting the preference.
 */
.chat-scroll-content {
  width: min(100%, var(--chat-content-max-width, 760px));
  margin-inline: auto;
}

/*
 * Long sessions keep every historical message in the layout tree; during
 * streaming each content change would otherwise re-run layout and paint for
 * the entire transcript. `content-visibility: auto` lets the engine skip
 * off-screen messages entirely. The `auto` keyword in contain-intrinsic-size
 * remembers each message's last rendered height once measured, so scrollbar
 * geometry and scroll positions stay stable (initial estimate 120px).
 *
 * The latest turn (and the optional error line after it) stay fully laid out
 * so streaming height changes are reflected in scrollHeight immediately.
 */
.chat-scroll-content > :deep(*) {
  content-visibility: auto;
  contain-intrinsic-size: auto 120px;
}

.chat-scroll-content > :deep(:nth-last-child(-n + 2)) {
  content-visibility: visible;
}
</style>
