<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProviderPreset } from '@shared/constants/provider-presets'
import {
  ADD_CATALOG_SUBSCRIPTIONS,
  buildAddCatalog,
  type AddCatalogSubscriptionId
} from '@shared/providers/add-catalog'
import { showSponsorSection, SPONSOR_MAIL, sponsorsForQuery } from '@shared/providers/sponsors'
import { Heart } from '@lucide/vue'
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import LocalAccountsPanel from '@renderer/components/providers/LocalAccountsPanel.vue'
import { getApi } from '@renderer/composables/useApi'

import { providerIcon } from './provider-icons'

const props = defineProps<{
  presets: readonly ProviderPreset[]
  partnerIds?: readonly string[]
  configuredIds?: readonly string[]
  addOnly: boolean
  initialDetail?: AddCatalogSubscriptionId | null
  accountId?: string
  query?: string
}>()
const emit = defineEmits<{
  'select-preset': [id: string]
  'update:detail': [id: AddCatalogSubscriptionId | null]
  'account-added': []
  'edit-provider': [key: string]
}>()
const { t } = useI18n()
const detail = ref<AddCatalogSubscriptionId | null>(props.initialDetail ?? null)
const openRouterPending = ref(false)
const openRouterFailed = ref(false)
const openRouterConfirm = ref(false)
onBeforeUnmount(() => {
  if (openRouterPending.value) void cancelOpenRouter()
})

watch(
  () => props.initialDetail,
  (value) => {
    detail.value = value ?? null
  }
)
watch(detail, (value) => emit('update:detail', value))

const sections = computed(() =>
  buildAddCatalog(props.presets, props.query ?? '', props.partnerIds ?? [])
)
const sponsors = computed(() => sponsorsForQuery(props.query ?? ''))
const sponsorSection = computed(() => showSponsorSection(props.query ?? ''))
const subscription = computed(() =>
  ADD_CATALOG_SUBSCRIPTIONS.find((item) => item.id === detail.value)
)

function configured(id: string): boolean {
  return props.configuredIds?.includes(id) ?? false
}

function configureApi() {
  const current = subscription.value
  const presetId = current && 'apiPresetId' in current ? current.apiPresetId : undefined
  if (presetId) emit('select-preset', presetId)
}

async function connectOpenRouter() {
  openRouterConfirm.value = false
  openRouterPending.value = true
  openRouterFailed.value = false
  try {
    await getApi().accounts.connectOpenRouter()
    openRouterPending.value = false
    emit('account-added')
  } catch (error) {
    const details = (error as { details?: { reason?: string } })?.details
    openRouterFailed.value = details?.reason !== 'cancelled'
  } finally {
    openRouterPending.value = false
  }
}

async function cancelOpenRouter() {
  await getApi()
    .accounts.cancelOpenRouter()
    .catch(() => {})
}

function becomeSponsor() {
  void getApi().system.openExternal(SPONSOR_MAIL)
}

function openSponsor(url: string) {
  void getApi().system.openExternal(url)
}
</script>

<template>
  <div data-testid="add-provider-catalog">
    <div v-if="detail" class="space-y-3">
      <Button
        size="sm"
        class="self-start"
        data-testid="add-provider-back"
        :disabled="openRouterPending"
        @click="detail = null"
      >
        {{ t('providerAccounts.catalogBack') }}
      </Button>
      <LocalAccountsPanel
        v-if="detail === 'chatgpt' || detail === 'claude' || detail === 'gemini'"
        :focus="detail"
        :add-only="addOnly"
        :account-id="detail === 'chatgpt' ? accountId : undefined"
        @configure-api="configureApi"
        @account-added="emit('account-added')"
        @edit-provider="emit('edit-provider', $event)"
      />
      <div v-else-if="detail === 'openrouter'" class="space-y-3">
        <p class="text-sm text-[var(--text-secondary)]">
          {{ t('providerAccounts.openRouter.hint') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            :loading="openRouterPending"
            data-testid="openrouter-connect"
            @click="openRouterConfirm = true"
          >
            {{ t('providerAccounts.openRouter.connect') }}
          </Button>
          <Button v-if="openRouterPending" size="sm" @click="cancelOpenRouter">
            {{ t('common.cancel') }}
          </Button>
          <Button v-else size="sm" @click="configureApi">
            {{ t('providerAccounts.useApiPreset') }}
          </Button>
        </div>
        <Dialog
          :open="openRouterConfirm"
          :title="t('providerAccounts.authorizeTitle', { name: 'OpenRouter' })"
          @update:open="
            (open) => {
              if (!open) openRouterConfirm = false
            }
          "
        >
          <p class="text-sm text-[var(--text-secondary)]">
            {{ t('providerAccounts.authorizeHint', { name: 'OpenRouter' }) }}
          </p>
          <template #footer>
            <Button size="sm" @click="openRouterConfirm = false">{{ t('common.cancel') }}</Button>
            <Button
              size="sm"
              variant="primary"
              data-testid="openrouter-connect-confirm"
              @click="connectOpenRouter"
            >
              {{ t('providerAccounts.authorizeContinue') }}
            </Button>
          </template>
        </Dialog>
        <p v-if="openRouterPending || openRouterFailed" role="status" class="text-xs">
          {{
            t(openRouterPending ? 'providerAccounts.browser' : 'providerAccounts.openRouter.failed')
          }}
        </p>
      </div>
      <p
        v-else
        class="text-xs text-[var(--text-secondary)]"
        data-testid="subscription-limit-copilot"
      >
        {{ t('providerAccounts.subscriptionLimit.copilot') }}
      </p>
    </div>
    <template v-else>
      <section v-if="sponsorSection" class="pt-1" data-testid="sponsor-section">
        <div class="flex items-center gap-2 px-2 pb-1.5">
          <h3 class="text-[13px] font-semibold text-[var(--text-primary)]">
            {{ t('providerAccounts.catalogGroup.partner') }}
          </h3>
          <p class="text-[12px] text-[var(--text-tertiary)]">
            {{ t('providerAccounts.catalogHint.partner') }}
          </p>
          <Button size="sm" class="ml-auto" data-testid="become-sponsor" @click="becomeSponsor">
            <Heart class="size-3.5" :stroke-width="1.75" />
            {{ t('providerAccounts.becomeSponsor') }}
          </Button>
        </div>
        <div
          v-if="sponsors.length"
          class="grid gap-x-3 gap-y-px"
          style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))"
        >
          <button
            v-for="sponsor in sponsors"
            :key="sponsor.id"
            type="button"
            class="flex h-[34px] min-w-0 items-center gap-2.5 rounded-lg px-2 text-left hover:bg-[var(--bg-hover)]"
            :data-testid="'sponsor-' + sponsor.id"
            :title="t(`providerAccounts.sponsorNote.${sponsor.id}`)"
            @click="openSponsor(sponsor.url)"
          >
            <span
              class="grid size-[18px] shrink-0 place-items-center rounded bg-[var(--bg-hover)] text-[10px] text-[var(--text-secondary)]"
              >{{ sponsor.name.slice(0, 1) }}</span
            >
            <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">{{
              sponsor.name
            }}</span>
            <span class="shrink-0 text-[11px] text-[var(--text-tertiary)]">{{
              t('providerAccounts.sponsored')
            }}</span>
          </button>
        </div>
      </section>
      <p
        v-if="sections.length === 0 && sponsors.length === 0"
        class="py-3 text-xs text-[var(--text-secondary)]"
        data-testid="add-provider-empty"
      >
        {{ t('providerAccounts.noCatalogMatch') }}
      </p>
      <section v-for="section in sections" :key="section.group" class="pt-5 first:pt-1">
        <div class="flex items-baseline gap-2 px-2 pb-1.5">
          <h3 class="text-[13px] font-semibold text-[var(--text-primary)]">
            {{ t(`providerAccounts.catalogGroup.${section.group}`) }}
          </h3>
          <p class="text-[12px] text-[var(--text-tertiary)]">
            {{ t(`providerAccounts.catalogHint.${section.group}`) }}
          </p>
        </div>
        <div
          class="grid gap-x-3 gap-y-px"
          style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))"
        >
          <button
            v-for="item in section.subscriptions"
            :key="item.id"
            type="button"
            class="flex h-[34px] min-w-0 items-center gap-2.5 rounded-lg px-2 text-left hover:bg-[var(--bg-hover)]"
            :data-testid="'add-provider-subscription-' + item.id"
            @click="detail = item.id"
          >
            <img
              v-if="providerIcon(item.id)?.url"
              :src="providerIcon(item.id)?.url"
              alt=""
              class="size-[18px] shrink-0"
            />
            <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">{{
              item.name
            }}</span>
            <span
              v-if="configured(item.id)"
              class="size-1.5 shrink-0 rounded-full bg-[var(--success)]"
            />
          </button>
          <button
            v-for="preset in section.presets"
            :key="preset.id"
            type="button"
            class="flex h-[34px] min-w-0 items-center gap-2.5 rounded-lg px-2 text-left hover:bg-[var(--bg-hover)]"
            :data-testid="'add-provider-preset-' + preset.id"
            :title="preset.defaultBaseUrl || preset.name"
            @click="emit('select-preset', preset.id)"
          >
            <img
              v-if="providerIcon(preset.id)?.url"
              :src="providerIcon(preset.id)?.url"
              alt=""
              class="size-[18px] shrink-0"
            />
            <span
              v-else
              class="grid size-[18px] shrink-0 place-items-center rounded bg-[var(--bg-hover)] text-[10px] text-[var(--text-secondary)]"
              >{{ preset.name.slice(0, 1) }}</span
            >
            <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">{{
              preset.name
            }}</span>
            <span
              v-if="configured(preset.id)"
              class="size-1.5 shrink-0 rounded-full bg-[var(--success)]"
            />
          </button>
        </div>
      </section>
    </template>
  </div>
</template>
