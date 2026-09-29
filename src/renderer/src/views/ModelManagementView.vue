<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Cpu, Server } from '@lucide/vue'
import PageHeader from '@renderer/components/common/PageHeader.vue'
import ModelsView from '@renderer/views/ModelsView.vue'
import ProvidersView from '@renderer/views/ProvidersView.vue'
import { useProvidersStore } from '@renderer/stores/providers'

type ManagementTab = 'providers' | 'models'

const route = useRoute()
const router = useRouter()
const providersStore = useProvidersStore()
const providerStateReady = ref(false)

const requestedTab = computed<ManagementTab>(() =>
  route.query.tab === 'providers' ? 'providers' : 'models'
)
const hasConfiguredProvider = computed(() => providersStore.items.length > 0)
const activeTab = computed<ManagementTab>(() => {
  if (!providerStateReady.value) return requestedTab.value
  return requestedTab.value === 'models' && !hasConfiguredProvider.value
    ? 'providers'
    : requestedTab.value
})

function selectTab(tab: ManagementTab): void {
  if (tab === 'models' && !hasConfiguredProvider.value) return
  void router.replace({ path: '/models', query: tab === 'providers' ? { tab } : {} })
}

function enforceProviderFirst(): void {
  if (!providerStateReady.value || requestedTab.value !== 'models' || hasConfiguredProvider.value) {
    return
  }
  void router.replace({ path: '/models', query: { tab: 'providers' } })
}

watch([requestedTab, hasConfiguredProvider, providerStateReady], enforceProviderFirst)

onMounted(async () => {
  await providersStore.fetchList()
  providerStateReady.value = true
  enforceProviderFirst()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="model-management-view">
    <PageHeader>
      <div class="flex min-w-0 flex-col justify-center self-stretch">
        <h1
          class="text-[15px] font-semibold leading-[18px] tracking-tight text-[var(--text-primary)]"
        >
          {{ $t('models.title') }}
        </h1>
        <p class="mt-[3px] text-[11.5px] leading-[14px] text-[var(--text-tertiary)]">
          {{ $t('models.managementSubtitle') }}
        </p>
      </div>
    </PageHeader>

    <div class="relative min-h-0 flex-1">
      <div
        class="absolute left-5 top-0 z-20 flex h-[48px] items-end"
        role="tablist"
        :aria-label="$t('models.managementTabsLabel')"
      >
        <button
          type="button"
          role="tab"
          data-testid="model-management-tab-providers"
          class="relative flex h-full items-center gap-1.5 px-3 text-[12px] transition-colors"
          :class="
            activeTab === 'providers'
              ? 'font-medium text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
          "
          :aria-selected="activeTab === 'providers'"
          @click="selectTab('providers')"
        >
          <Server class="size-3.5" :stroke-width="1.75" />
          {{ $t('navShort.providers') }}
          <span
            v-if="activeTab === 'providers'"
            class="absolute inset-x-2 bottom-0 h-[2px] rounded-t-full bg-[var(--accent)]"
          />
        </button>
        <button
          type="button"
          role="tab"
          data-testid="model-management-tab-models"
          class="relative flex h-full items-center gap-1.5 px-3 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          :class="
            activeTab === 'models'
              ? 'font-medium text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
          "
          :aria-selected="activeTab === 'models'"
          :aria-describedby="!hasConfiguredProvider ? 'model-provider-required' : undefined"
          :disabled="!providerStateReady || !hasConfiguredProvider"
          @click="selectTab('models')"
        >
          <Cpu class="size-3.5" :stroke-width="1.75" />
          {{ $t('models.title') }}
          <span
            v-if="activeTab === 'models'"
            class="absolute inset-x-2 bottom-0 h-[2px] rounded-t-full bg-[var(--accent)]"
          />
        </button>
        <p
          v-if="providerStateReady && !hasConfiguredProvider"
          id="model-provider-required"
          class="ml-2 self-center text-[11px] text-[var(--warning)]"
        >
          {{ $t('models.providerRequired') }}
        </p>
      </div>

      <div
        v-if="!providerStateReady"
        class="flex h-full min-h-0 items-center justify-center border-t border-[var(--border-subtle)] text-[11.5px] text-[var(--text-tertiary)]"
      >
        {{ $t('common.loading') }}
      </div>
      <div v-else class="h-full min-h-0">
        <ProvidersView v-if="activeTab === 'providers'" embedded />
        <ModelsView v-else embedded />
      </div>
    </div>
  </div>
</template>
