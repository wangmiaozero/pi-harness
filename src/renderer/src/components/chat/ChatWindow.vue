<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import MessageView from './MessageView.vue'
import ChatComposer from './ChatComposer.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { ArrowDown, ArrowUp, Check, Copy, Gauge, History, MessageSquare } from '@lucide/vue'
import { useAgentStore } from '@renderer/stores/agent'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useModelsStore } from '@renderer/stores/models'
import { useSettingsStore } from '@renderer/stores/settings'
import type { ToolPreset } from '@shared/workspace/tool-presets'
import type { AgentImageAttachment } from '@shared/types/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'
import { useCompletionSound } from '@renderer/composables/useCompletionSound'

const { locale } = useI18n()
const agent = useAgentStore()
const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const models = useModelsStore()
const settings = useSettingsStore()
const scroller = ref<HTMLElement | null>(null)
const scrollContent = ref<HTMLElement | null>(null)
const composer = ref<InstanceType<typeof ChatComposer> | null>(null)
const statsOpen = ref(false)
const copiedField = ref<'file' | 'id' | null>(null)
const hasScrollOverflow = ref(false)
const atScrollTop = ref(true)
const atScrollBottom = ref(true)
const completionSound = useCompletionSound()
let stickToBottom = true
let scrollResizeObserver: ResizeObserver | null = null

const SCROLL_EDGE_THRESHOLD = 24

function focusComposer() {
  composer.value?.focus()
}

defineExpose({ focusComposer })

const stats = computed(() => agent.sessionStats)
const contextUsage = computed(() => agent.state?.contextUsage ?? null)
const contextPercent = computed(() => contextUsage.value?.percent ?? null)
const contextColor = computed(() => {
  const percent = contextPercent.value
  if (percent !== null && percent > 90) return 'var(--danger)'
  if (percent !== null && percent > 70) return 'var(--warning)'
  return 'var(--text-tertiary)'
})

const displayMessages = computed(() => {
  const live = agent.streaming.streamingMessage
  return live ? [...agent.messages, live] : agent.messages
})

function updateScrollState() {
  const el = scroller.value
  if (!el) return
  const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
  hasScrollOverflow.value = maxScrollTop > 1
  atScrollTop.value = el.scrollTop <= SCROLL_EDGE_THRESHOLD
  atScrollBottom.value = maxScrollTop - el.scrollTop <= SCROLL_EDGE_THRESHOLD
}

function onScrollerScroll() {
  updateScrollState()
  stickToBottom = atScrollBottom.value
}

function syncAfterContentResize() {
  const el = scroller.value
  if (!el) return
  if (stickToBottom) el.scrollTop = el.scrollHeight
  updateScrollState()
}

function scrollToEdge(edge: 'top' | 'bottom', behavior?: ScrollBehavior) {
  const el = scroller.value
  if (!el) return
  stickToBottom = edge === 'bottom'
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  el.scrollTo({
    top: edge === 'top' ? 0 : el.scrollHeight,
    behavior: behavior ?? (reducedMotion ? 'auto' : 'smooth')
  })
}

watch(displayMessages, async () => {
  await nextTick()
  syncAfterContentResize()
})

onMounted(async () => {
  await nextTick()
  if (typeof ResizeObserver !== 'undefined') {
    scrollResizeObserver = new ResizeObserver(syncAfterContentResize)
    if (scroller.value) scrollResizeObserver.observe(scroller.value)
    if (scrollContent.value) scrollResizeObserver.observe(scrollContent.value)
  }
  syncAfterContentResize()
})

onBeforeUnmount(() => scrollResizeObserver?.disconnect())

watch(
  () => agent.completionCount,
  (next, previous) => {
    if (next > previous) void completionSound.play()
  }
)

watch(
  () => sessions.currentId,
  async () => {
    statsOpen.value = false
    copiedField.value = null
    stickToBottom = true
    await nextTick()
    scrollToEdge('bottom', 'auto')
  }
)

async function onSend() {
  const text = workspace.draft.trim()
  const draftKey = workspace.draftKey
  const images: AgentImageAttachment[] = workspace.draftImages.map(({ data, mimeType }) => ({
    type: 'image',
    data,
    mimeType
  }))
  if (!text && !images.length) return
  const preset = (
    sessions.currentId ? agent.activePreset() : (settings.settings?.defaultToolPreset ?? 'default')
  ) as ToolPreset
  await completionSound.unlock()
  const sessionId = await agent.send(sessions.currentId, workspace.currentCwd, text, preset, images)
  if (agent.error) return
  workspace.clearDraft(draftKey)
  if (sessionId && sessionId !== sessions.currentId) {
    sessions.selectSession(sessionId)
  }
}

async function onAbort() {
  if (sessions.currentId) await agent.abort(sessions.currentId)
}

async function viewFullHistory() {
  const sessionId = sessions.currentId
  if (!sessionId || sessions.current?.transient) return
  try {
    await callApi(() => getApi().sessions.viewFullHistory(sessionId))
  } catch (error) {
    toast.error((error as Error).message)
  }
}

async function copyStat(field: 'file' | 'id', value: string) {
  await navigator.clipboard.writeText(value)
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
  <div class="flex h-full min-h-0 flex-col">
    <div
      class="flex h-9 shrink-0 items-stretch border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] text-[var(--text-secondary)]"
    >
      <button
        type="button"
        class="inline-flex items-center gap-1.5 border-r border-[var(--border-subtle)] px-3 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!sessions.currentId || sessions.current?.transient"
        :title="
          sessions.currentId ? $t('workspace.fullHistory') : $t('workspace.fullHistoryUnavailable')
        "
        @click="viewFullHistory"
      >
        <History aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
        {{ $t('workspace.fullHistory') }}
      </button>
      <span class="flex min-w-0 items-center truncate px-3 text-[var(--text-tertiary)]">
        {{ models.active.providerKey }}/{{ models.active.modelId }} · {{ agent.thinkingLevel }}
      </span>
      <button
        v-if="stats || contextUsage"
        type="button"
        class="ml-auto inline-flex items-center gap-2 border-l border-[var(--border-subtle)] px-3 tabular-nums transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        :class="statsOpen ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : ''"
        :title="$t('workspace.sessionInfo')"
        :aria-expanded="statsOpen"
        @click="statsOpen = !statsOpen"
      >
        <span v-if="stats?.tokens.input" class="inline-flex items-center gap-1">
          <ArrowUp aria-hidden="true" class="size-3" />{{ compactNumber(stats.tokens.input) }}
        </span>
        <span v-if="stats?.tokens.output" class="inline-flex items-center gap-1">
          <ArrowDown aria-hidden="true" class="size-3" />{{ compactNumber(stats.tokens.output) }}
        </span>
        <span
          v-if="contextUsage?.contextWindow"
          class="inline-flex items-center gap-1"
          :style="{ color: contextColor }"
        >
          <Gauge aria-hidden="true" class="size-3" />
          {{ contextPercent === null ? '?' : `${Math.round(contextPercent)}%` }} /
          {{ compactNumber(contextUsage.contextWindow) }}
        </span>
      </button>
    </div>
    <div
      v-if="statsOpen"
      class="grid shrink-0 grid-cols-[minmax(320px,1.7fr)_minmax(150px,.55fr)_minmax(190px,.75fr)] gap-6 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-4 py-3 font-[family-name:var(--font-mono)] text-[11.5px] leading-5 shadow-[var(--shadow-sm)]"
    >
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
            <span class="text-[var(--text-tertiary)]">{{ $t('workspace.activeDuration') }}</span>
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
          <template v-if="contextUsage?.contextWindow">
            <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.context') }}</dt>
            <dd>
              {{ contextPercent === null ? '?' : `${contextPercent.toFixed(1)}%` }} /
              {{ compactNumber(contextUsage.contextWindow) }}
            </dd>
          </template>
        </dl>
      </section>
    </div>
    <div class="relative min-h-0 flex-1">
      <div
        ref="scroller"
        data-testid="chat-scroller"
        class="h-full min-h-0 overflow-y-auto px-4 py-3"
        @scroll.passive="onScrollerScroll"
      >
        <div ref="scrollContent">
          <EmptyState
            v-if="!displayMessages.length"
            :title="$t('workspace.emptyChat')"
            :description="$t('workspace.emptyChatHint')"
            :icon="MessageSquare"
          />
          <MessageView
            v-for="(message, index) in displayMessages"
            :key="index"
            :message="message"
            :entry-id="agent.entryIds[index]"
            :streaming="
              Boolean(agent.streaming.streamingMessage) && index === displayMessages.length - 1
            "
          />
          <p v-if="agent.error" class="mt-2 text-[12px] text-[var(--danger)]">
            {{ agent.error }}
          </p>
        </div>
      </div>
      <div
        v-if="hasScrollOverflow"
        data-testid="chat-scroll-controls"
        class="absolute bottom-3 right-4 z-20 flex flex-col gap-1"
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
    </div>
    <ChatComposer
      ref="composer"
      :sound-enabled="completionSound.enabled.value"
      @send="onSend"
      @abort="onAbort"
      @toggle-sound="completionSound.toggle"
      @unlock-audio="completionSound.unlock"
    />
  </div>
</template>
