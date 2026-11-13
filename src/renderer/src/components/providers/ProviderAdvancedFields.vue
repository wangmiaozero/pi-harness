<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Input from '@renderer/components/ui/Input.vue'
import Textarea from '@renderer/components/ui/Textarea.vue'
import Select from '@renderer/components/ui/Select.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import Button from '@renderer/components/ui/Button.vue'
import type { ProviderAdvancedSettings } from '@shared/providers/advanced-settings'
import type { ProtocolId } from '@shared/constants/protocols'

export type AdvancedDraft = {
  extraBody: string
  requestHeaders: string
  responseHeaders: string
  proxyMode: 'system' | 'direct' | 'custom' | ''
  proxyUrl: string
  concurrency: string
  requestsPerMinute: string
  queueLimit: string
  queueWaitSeconds: string
  priceMultiplier: string
  free: boolean
  billing: 'subscription' | 'metered' | ''
  authMode: 'both' | 'api-key' | 'bearer' | ''
  sendUserAgent: boolean
  redactSecrets: boolean
  responsesWebSocket: boolean
  nativeCompaction: boolean
  contextWindows: string
  outputLimits: string
  compactionThresholds: string
  rateWindows: NonNullable<ProviderAdvancedSettings['rateWindows']>
}

const draft = defineModel<AdvancedDraft>({ required: true })
defineProps<{ protocol: ProtocolId; chatGpt?: boolean }>()
const bodyExample = JSON.stringify({ prompt_cache_key: '${sessionId}' }, null, 2)
const { t } = useI18n()
const numberFields = ['concurrency', 'requestsPerMinute', 'queueLimit', 'queueWaitSeconds'] as const
const limits = [
  { key: 'contextWindows', presets: ['128K', '200K', '256K', '400K', '512K', '1M'] },
  { key: 'outputLimits', presets: ['8K', '16K', '32K', '64K', '128K'] },
  { key: 'compactionThresholds', presets: ['128K', '200K', '272K', '500K', '1M'] }
] as const
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 0, 4 + day))
    )
  )
)
function toggleDay(window: AdvancedDraft['rateWindows'][number], day: number) {
  const current = window.days ?? []
  window.days = current.includes(day) ? current.filter((item) => item !== day) : [...current, day]
}
</script>

<template>
  <div class="space-y-5" data-testid="provider-advanced-fields">
    <Textarea
      v-if="!chatGpt"
      v-model="draft.extraBody"
      :label="t('providerAdvanced.extraBody')"
      :placeholder="bodyExample"
      :rows="3"
      mono
    />
    <div class="grid gap-3 sm:grid-cols-2">
      <Input
        v-if="!chatGpt"
        v-model="draft.requestHeaders"
        :label="t('providerAdvanced.requestHeaders')"
        placeholder="X-Tenant-Id"
        mono
      />
      <Input
        v-if="!chatGpt"
        v-model="draft.responseHeaders"
        :label="t('providerAdvanced.responseHeaders')"
        placeholder="X-Trace-Id"
        mono
      />
      <Select
        v-model="draft.proxyMode"
        :label="t('providerAdvanced.proxy')"
        :options="[
          { value: '', label: t('providerAdvanced.automatic') },
          { value: 'system', label: t('providerAdvanced.system') },
          { value: 'direct', label: t('providerAdvanced.direct') },
          { value: 'custom', label: t('providerAdvanced.custom') }
        ]"
      />
      <Input
        v-if="draft.proxyMode === 'custom'"
        v-model="draft.proxyUrl"
        :label="t('providerAdvanced.proxyUrl')"
        placeholder="http://127.0.0.1:7890"
        mono
      />
      <Select
        v-if="!chatGpt"
        v-model="draft.authMode"
        :label="t('providerAdvanced.authMode')"
        :options="[
          { value: '', label: t('providerAdvanced.automatic') },
          { value: 'both', label: t('providerAdvanced.both') },
          { value: 'api-key', label: 'x-api-key' },
          { value: 'bearer', label: 'Authorization: Bearer' }
        ]"
      />
      <Input
        v-for="key in numberFields"
        :key="key"
        v-model="draft[key]"
        type="number"
        min="0"
        step="1"
        :label="t(`providerAdvanced.${key}`)"
        :placeholder="t('providerAdvanced.unlimited')"
      />
      <div v-if="!chatGpt" class="flex items-center justify-between gap-3">
        <span class="text-xs">{{ t('providerAdvanced.sendUserAgent') }}</span>
        <Switch v-model="draft.sendUserAgent" :label="t('providerAdvanced.sendUserAgent')" />
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs">{{ t('providerAdvanced.redactSecrets') }}</span>
        <Switch v-model="draft.redactSecrets" :label="t('providerAdvanced.redactSecrets')" />
      </div>
      <template v-if="!chatGpt && protocol === 'openai-responses'">
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs">{{ t('providerAdvanced.responsesWebSocket') }}</span>
          <Switch
            v-model="draft.responsesWebSocket"
            :label="t('providerAdvanced.responsesWebSocket')"
          />
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs">{{ t('providerAdvanced.nativeCompaction') }}</span>
          <Switch
            v-model="draft.nativeCompaction"
            :label="t('providerAdvanced.nativeCompaction')"
          />
        </div>
      </template>
      <slot name="limits" />
    </div>
    <section class="space-y-3 border-t border-[var(--border-subtle)] pt-3">
      <h3 class="text-sm font-semibold">{{ t('providerAdvanced.usage') }}</h3>
      <div class="grid gap-3 sm:grid-cols-2">
        <Input
          v-model="draft.priceMultiplier"
          type="number"
          min="0"
          step="any"
          :label="t('providerAdvanced.priceMultiplier')"
          placeholder="1"
        />
        <Select
          v-model="draft.billing"
          :label="t('providerAdvanced.billing')"
          :options="[
            { value: '', label: t('providerAdvanced.automatic') },
            { value: 'subscription', label: t('providerAdvanced.subscription') },
            { value: 'metered', label: t('providerAdvanced.metered') }
          ]"
        />
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs">{{ t('providerAdvanced.free') }}</span>
          <Switch v-model="draft.free" :label="t('providerAdvanced.free')" />
        </div>
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs">{{ t('providerAdvanced.rateWindows') }}</span>
        <Button
          size="sm"
          :disabled="draft.rateWindows.length >= 32"
          @click="draft.rateWindows.push({ start: '22:00', end: '06:00', multiplier: 1 })"
        >
          {{ t('providerAdvanced.addWindow') }}
        </Button>
      </div>
      <div
        v-for="(window, index) in draft.rateWindows"
        :key="index"
        class="space-y-2 rounded-lg border border-[var(--border-subtle)] p-2"
      >
        <div class="grid grid-cols-3 gap-2">
          <Input v-model="window.start" type="time" :label="t('providerAdvanced.start')" />
          <Input v-model="window.end" type="time" :label="t('providerAdvanced.end')" />
          <Input
            :model-value="String(window.multiplier)"
            type="number"
            min="0"
            step="any"
            :label="t('providerAdvanced.priceMultiplier')"
            @update:model-value="window.multiplier = $event === '' ? NaN : Number($event)"
          />
        </div>
        <div class="flex flex-wrap gap-1">
          <Button
            v-for="(day, dayIndex) in weekdays"
            :key="dayIndex"
            size="sm"
            :aria-pressed="window.days?.includes(dayIndex) ?? false"
            :variant="window.days?.includes(dayIndex) ? 'primary' : 'secondary'"
            @click="toggleDay(window, dayIndex)"
            >{{ day }}</Button
          >
          <Button size="sm" class="ml-auto" @click="draft.rateWindows.splice(index, 1)">{{
            t('common.delete')
          }}</Button>
        </div>
      </div>
    </section>
    <section class="space-y-3 border-t border-[var(--border-subtle)] pt-3">
      <div
        v-for="{ key, presets } in chatGpt
          ? limits.filter(({ key }) => key !== 'outputLimits')
          : limits"
        :key="key"
        class="space-y-1.5"
      >
        <Input
          v-model="draft[key]"
          :label="t(`providerAdvanced.${key}`)"
          :placeholder="t('providerAdvanced.tokenExample')"
          mono
        />
        <div class="flex flex-wrap gap-1">
          <Button v-for="preset in presets" :key="preset" size="sm" @click="draft[key] = preset">{{
            preset
          }}</Button>
        </div>
      </div>
    </section>
  </div>
</template>
