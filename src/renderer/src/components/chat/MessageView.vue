<script setup lang="ts">
import { markdownOptions, markdownPlugins } from './message-markdown'
import { computed, onErrorCaptured, ref } from 'vue'
import { Archive, Brain, ChevronRight } from '@lucide/vue'
import type { AgentMessage, ImageContent } from '@shared/types/workspace'
import ToolCallView from './ToolCallView.vue'
import MessageActions from './MessageActions.vue'
import BranchNavigator from './BranchNavigator.vue'
import DeferredMarkdown from './DeferredMarkdown.vue'
import FileChangesCard from './FileChangesCard.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import type { MessageFileChanges } from './message-file-changes'
import type { ToolResults } from './message-activity'
import { normalizeAssistantName, normalizeUserName } from '@shared/constants/chat-participants'
import { hasRenderableMessageContent } from './message-visibility'
import { parseSkillInvocation } from './skill-invocation'
import { stripImageMetadataSuffix } from '@shared/workspace/image-attachments'
import { callApi, getApi } from '@renderer/composables/useApi'

const props = defineProps<{
  message: AgentMessage
  entryId?: string
  streaming?: boolean
  fileChanges?: MessageFileChanges
  userName?: string
  assistantName?: string
  toolResults?: ToolResults
  pendingToolCalls?: ReadonlyMap<string, string>
  activityRunning?: boolean
  embedded?: boolean
}>()
const compactionOpen = ref(false)
const isCompaction = computed(
  () => props.message.role === 'custom' && props.message.customType === 'compaction'
)
const previewSrc = ref<string | null>(null)
const previewOpen = ref(false)
const markdownFailed = ref(false)
const userDisplayName = computed(() => normalizeUserName(props.userName))
const assistantDisplayName = computed(() => normalizeAssistantName(props.assistantName))
const hasVisibleContent = computed(
  () =>
    hasRenderableMessageContent(props.message) ||
    (props.message.role === 'assistant' && Boolean(props.fileChanges) && !props.streaming)
)

onErrorCaptured(() => {
  markdownFailed.value = true
  return false
})

function imageSource(image: ImageContent): string | null {
  if (typeof image.data !== 'string' || !image.data) return null
  const mime =
    typeof image.mimeType === 'string' && image.mimeType.startsWith('image/')
      ? image.mimeType
      : 'image/png'
  return `data:${mime};base64,${image.data}`
}

function openPreview(src: string) {
  previewSrc.value = src
  previewOpen.value = true
}

/**
 * Markdown links must open in the user's browser: the window blocks in-app
 * navigation and scripted popups, so intercept anchor clicks and hand the URL
 * to the shell instead.
 */
async function openExternalLink(event: MouseEvent): Promise<void> {
  const anchor = (event.target as HTMLElement | null)?.closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href')
  if (!href) return
  event.preventDefault()
  event.stopPropagation()
  if (!/^(https?:|mailto:)/i.test(href)) return
  try {
    await callApi(() => getApi().system.openExternal(href))
  } catch {
    /* the shell rejects invalid URLs; nothing to show in a chat bubble */
  }
}

function openImage(image: ImageContent) {
  const src = imageSource(image)
  if (src) openPreview(src)
}

const userText = computed(() => {
  const msg = props.message
  if (msg.role !== 'user') return ''
  const hasImages = typeof msg.content !== 'string' && msg.content.some((b) => b.type === 'image')
  const raw =
    typeof msg.content === 'string'
      ? msg.content
      : msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('\n')
  // Pi appends an `[Image: …]` metadata line to persisted image prompts; it is
  // model-facing context and should never be shown to the user.
  return stripImageMetadataSuffix(raw, hasImages).trim()
})
const userSkillInvocation = computed(() => parseSkillInvocation(userText.value))
const displayedUserText = computed(() => userSkillInvocation.value?.prompt ?? userText.value)

const userImages = computed(() => {
  const msg = props.message
  if (msg.role !== 'user' || typeof msg.content === 'string') return []
  return msg.content.flatMap((block) => {
    if (block.type !== 'image') return []
    const src = imageSource(block)
    return src ? [src] : []
  })
})

const hasNarrative = computed(() => {
  const message = props.message
  return (
    message.role !== 'assistant' ||
    Boolean(message.errorMessage || props.fileChanges) ||
    message.content.some(
      (block) => (block.type === 'text' && block.text.trim()) || block.type === 'image'
    )
  )
})
const standaloneTool = computed(() => {
  const message = props.message
  if (message.role === 'toolResult')
    return {
      block: {
        type: 'toolCall' as const,
        toolCallId: message.toolCallId,
        toolName: message.toolName ?? '',
        input: {}
      },
      result: message
    }
  if (message.role === 'bashExecution')
    return {
      block: {
        type: 'toolCall' as const,
        toolCallId: '',
        toolName: 'bash',
        input: { command: message.command }
      },
      result: {
        role: 'toolResult' as const,
        toolCallId: '',
        toolName: 'bash',
        content: [{ type: 'text' as const, text: message.output }],
        isError: message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0),
        details: { exitCode: message.exitCode, cancelled: message.cancelled }
      }
    }
  return null
})

const messageCopyText = computed(() => {
  const msg = props.message
  if (msg.role === 'user') return displayedUserText.value
  if (msg.role !== 'assistant') return ''
  return typeof msg.content === 'string'
    ? msg.content
    : msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('\n\n')
})
</script>

<template>
  <article
    v-if="hasVisibleContent"
    :class="embedded ? 'message-part mb-3' : 'message-hud group mb-3'"
    :data-message-role="embedded ? undefined : message.role"
  >
    <p
      v-if="
        !embedded &&
        !isCompaction &&
        hasNarrative &&
        message.role !== 'toolResult' &&
        message.role !== 'bashExecution'
      "
      class="message-role-label"
    >
      <span class="message-role-badge">
        <template v-if="message.role === 'user'">{{ userDisplayName }}</template>
        <template v-else-if="message.role === 'assistant'">
          {{ assistantDisplayName }}
          <span v-if="streaming"> · {{ $t('workspace.streaming') }}</span>
        </template>
        <template v-else>{{ message.customType }}</template>
      </span>
    </p>

    <template v-if="message.role === 'user'">
      <div class="user-message-body px-3.5 py-2.5 text-[13px] text-[var(--text-primary)]">
        <div
          v-if="userSkillInvocation"
          data-testid="skill-invocation"
          class="mb-1.5 inline-flex items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] font-medium text-[var(--accent)]"
        >
          @{{ userSkillInvocation.name }}
        </div>
        <p v-if="displayedUserText" class="whitespace-pre-wrap">{{ displayedUserText }}</p>
        <div
          v-if="userImages.length"
          class="flex flex-wrap gap-2"
          :class="displayedUserText || userSkillInvocation ? 'mt-2' : ''"
        >
          <button
            v-for="(src, index) in userImages"
            :key="index"
            type="button"
            class="block size-[72px] overflow-hidden rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            :title="$t('workspace.previewImage')"
            @click="openPreview(src)"
          >
            <img :src="src" alt="" loading="lazy" class="size-full object-cover" />
          </button>
        </div>
      </div>

      <MessageActions v-if="!embedded" :text="messageCopyText" role="user" />
    </template>

    <template v-else-if="message.role === 'assistant'">
      <div class="assistant-message-body space-y-2" @click.capture="openExternalLink">
        <template v-for="(block, i) in message.content" :key="i">
          <p
            v-if="block.type === 'text' && block.text.trim() && markdownFailed"
            class="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]"
          >
            {{ block.text }}
          </p>
          <Suspense v-else-if="block.type === 'text' && block.text.trim()">
            <DeferredMarkdown
              :value="block.text"
              :options="markdownOptions"
              :plugins="markdownPlugins"
              :streaming="streaming"
              class="markdown-content"
            />
            <template #fallback>
              <p class="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]">
                {{ block.text }}
              </p>
            </template>
          </Suspense>
          <details
            v-else-if="block.type === 'thinking'"
            data-testid="thinking-details"
            class="thinking-hud"
          >
            <summary class="thinking-summary">
              <Brain aria-hidden="true" class="size-3.5 shrink-0" />
              {{ $t('workspace.thinking') }}
              <ChevronRight aria-hidden="true" class="thinking-chevron ml-auto size-3 shrink-0" />
            </summary>
            <p class="mt-1 whitespace-pre-wrap text-[12px] text-[var(--text-secondary)]">
              {{ block.thinking || (block.deferred ? $t('workspace.thinkingDeferred') : '') }}
            </p>
          </details>
          <ToolCallView
            v-else-if="block.type === 'toolCall'"
            :block="block"
            :result="toolResults?.get(block.toolCallId)?.message"
            :result-entry-id="toolResults?.get(block.toolCallId)?.entryId"
            :running="activityRunning && pendingToolCalls?.has(block.toolCallId)"
          />
          <button
            v-else-if="block.type === 'image' && imageSource(block)"
            type="button"
            class="block max-w-[320px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            :title="$t('workspace.previewImage')"
            @click="openImage(block)"
          >
            <img
              :src="imageSource(block) ?? ''"
              alt=""
              loading="lazy"
              class="max-h-[280px] w-full object-contain"
            />
          </button>
        </template>
        <p
          v-if="message.errorMessage"
          data-testid="assistant-error"
          class="rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--danger)]"
        >
          {{ message.errorMessage }}
        </p>
        <FileChangesCard v-if="fileChanges && !streaming" :changes="fileChanges" />
      </div>

      <MessageActions
        v-if="!embedded && !streaming && messageCopyText.trim()"
        :text="messageCopyText"
        role="assistant"
      />
    </template>

    <details
      v-else-if="isCompaction"
      data-testid="compaction-details"
      class="thinking-hud"
      @toggle="compactionOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary class="thinking-summary">
        <Archive aria-hidden="true" class="size-3.5 shrink-0" />
        {{ $t('workspace.compactDone') }}
        <ChevronRight aria-hidden="true" class="thinking-chevron size-3 shrink-0" />
      </summary>
      <pre
        v-if="compactionOpen"
        class="max-h-80 overflow-auto whitespace-pre-wrap border-l border-[var(--border-subtle)] pl-3 text-[12px] leading-relaxed text-[var(--text-secondary)]"
        >{{
          message.role === 'custom' && typeof message.content === 'string' ? message.content : ''
        }}</pre>
    </details>

    <ToolCallView
      v-else-if="standaloneTool"
      :data-testid="
        message.role === 'toolResult' ? 'tool-result-details' : 'bash-execution-details'
      "
      :block="standaloneTool.block"
      :result="standaloneTool.result"
      :hide-input="message.role === 'toolResult'"
    />

    <p v-else class="whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]">
      {{ message.role === 'custom' && typeof message.content === 'string' ? message.content : '' }}
    </p>

    <BranchNavigator v-if="entryId" :entry-id="entryId" />

    <Dialog v-model:open="previewOpen" wide :title="$t('workspace.previewImage')">
      <img v-if="previewSrc" :src="previewSrc" alt="" class="max-h-[68vh] w-full object-contain" />
    </Dialog>
  </article>
</template>

<style scoped>
.message-hud,
.message-part {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  margin-inline: auto;
  overflow-wrap: anywhere;
}

.thinking-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  list-style: none;
}
.thinking-summary::-webkit-details-marker {
  display: none;
}
.thinking-summary:hover {
  color: var(--text-primary);
}
.thinking-summary:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.thinking-hud[open] .thinking-chevron {
  transform: rotate(90deg);
}
.thinking-hud > p {
  max-height: 20rem;
  overflow: auto;
  margin: 3px 0 10px 7px;
  padding: 6px 13px;
  border-left: 1px solid var(--border-subtle);
  line-height: 1.6;
}
.message-role-label {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
  color: var(--text-tertiary);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  line-height: 1.3;
  text-transform: uppercase;
}

.message-role-badge {
  display: inline-flex;
  align-items: center;
  min-height: 21px;
  padding: 2px 8px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-surface-raised) 78%, transparent);
}

.message-hud[data-message-role='user'] .message-role-label {
  justify-content: flex-end;
  color: var(--accent);
}

.message-hud[data-message-role='user'] .message-role-badge {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border-subtle));
  background: var(--accent-tint);
}

/*
 * The user bubble hugs the trailing edge, so its hover actions (copy button)
 * must follow it; otherwise the button lands at the container's left edge,
 * visually detached from the bubble and colliding with the next role label.
 */
.message-hud[data-message-role='user'] .message-actions {
  justify-content: flex-end;
}

/*
 * User bubbles shrink-wrap their content and hug the trailing edge, like a
 * chat bubble. `max-content` keeps short prompts compact; the cap keeps long
 * prompts and image strips inside the readable band.
 */
.message-hud[data-message-role='user'] .user-message-body {
  width: fit-content;
  max-width: min(100%, 600px);
  margin-left: auto;
}

.user-message-body {
  border: none;
  border-radius: var(--message-radius) var(--message-radius) var(--radius-xs) var(--message-radius);
  background: color-mix(in oklab, var(--accent) 5%, var(--bg-surface-raised));
  box-shadow: var(--shadow-sm);
}

.assistant-message-body {
  padding: 12px 14px;
  border: none;
  border-radius: var(--message-radius) var(--message-radius) var(--message-radius) var(--radius-xs);
  background: transparent;
  box-shadow: none;
}

@media (max-width: 720px) {
  .message-hud {
    width: 100%;
  }
}

.markdown-content {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.65;
}

.markdown-content :deep(p),
.markdown-content :deep(ul),
.markdown-content :deep(ol),
.markdown-content :deep(pre),
.markdown-content :deep(blockquote),
.markdown-content :deep(table) {
  margin: 0 0 0.75em;
}

.markdown-content :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin: 1.15em 0 0.55em;
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.3;
}

.markdown-content :deep(h1:first-child),
.markdown-content :deep(h2:first-child),
.markdown-content :deep(h3:first-child),
.markdown-content :deep(h4:first-child),
.markdown-content :deep(h5:first-child),
.markdown-content :deep(h6:first-child) {
  margin-top: 0;
}

.markdown-content :deep(h1) {
  font-size: 1.45em;
}

.markdown-content :deep(h2) {
  font-size: 1.3em;
}

.markdown-content :deep(h3) {
  font-size: 1.15em;
}

.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  font-size: 1em;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
}

.markdown-content :deep(ul) {
  list-style: disc;
}

.markdown-content :deep(ol) {
  list-style: decimal;
}

.markdown-content :deep(li) {
  margin: 0.2em 0;
}

.markdown-content :deep(li > ul),
.markdown-content :deep(li > ol) {
  margin: 0.2em 0;
}

.markdown-content :deep(strong) {
  font-weight: 650;
}

.markdown-content :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-content :deep(code) {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xs);
  background: var(--code-bg);
  padding: 0.08em 0.35em;
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.markdown-content :deep(pre) {
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  padding: 10px 12px;
  line-height: 1.55;
}

.markdown-content :deep(pre code) {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  font-size: 12px;
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--border-strong);
  padding-left: 0.85em;
  color: var(--text-secondary);
}

.markdown-content :deep(hr) {
  margin: 1em 0;
  border: 0;
  border-top: 1px solid var(--border-subtle);
}

.markdown-content :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--border-default);
  padding: 5px 8px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--bg-surface);
  font-weight: 600;
}

.markdown-content :deep(img) {
  max-width: 100%;
  border-radius: var(--radius-sm);
}

.markdown-content :deep(.contains-task-list) {
  padding-left: 0;
  list-style: none;
}

.markdown-content :deep(.task-list-item) {
  list-style: none;
}

.markdown-content :deep(.task-list-item-checkbox) {
  width: 13px;
  height: 13px;
  margin: 0 0.45em 0 0;
  vertical-align: -2px;
  accent-color: var(--accent);
  appearance: auto;
}
</style>
