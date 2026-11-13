<script setup lang="ts">
import { ref } from 'vue'
import { ExternalLink, GitFork, Heart, Mail, Star, UserRound } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import Button from '@renderer/components/ui/Button.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { getApi } from '@renderer/composables/useApi'
import {
  APP_AUTHOR,
  APP_NAME,
  APP_VERSION,
  PROJECT_REPOSITORY_URL,
  type ProjectLinkTarget
} from '@shared/constants'
import { APP_SPONSORS, SPONSOR_MAIL } from '@shared/providers/sponsors'

const { t } = useI18n()
const opening = ref<ProjectLinkTarget | null>(null)
const openingExternal = ref(false)

async function openProjectLink(target: ProjectLinkTarget): Promise<void> {
  opening.value = target
  try {
    await getApi().system.openProjectLink(target)
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('common.failed'))
  } finally {
    opening.value = null
  }
}

async function openExternal(url: string): Promise<void> {
  openingExternal.value = true
  try {
    await getApi().system.openExternal(url)
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('common.failed'))
  } finally {
    openingExternal.value = false
  }
}
</script>

<template>
  <InspectorSection
    data-testid="about-settings"
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <template #title>{{ APP_NAME }}</template>

    <PropertyRow :label="$t('settings.currentVersion')" mono>
      {{ APP_VERSION }}
    </PropertyRow>
    <PropertyRow :label="$t('settings.aboutAuthor')">
      <span class="inline-flex items-center gap-1.5">
        <UserRound aria-hidden="true" class="size-3.5 text-[var(--text-tertiary)]" />
        {{ APP_AUTHOR.name }}
      </span>
    </PropertyRow>
    <PropertyRow :label="$t('settings.aboutEmail')" mono :title="APP_AUTHOR.email">
      <span class="inline-flex min-w-0 items-center gap-1.5">
        <Mail aria-hidden="true" class="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
        <span class="truncate">{{ APP_AUTHOR.email }}</span>
      </span>
    </PropertyRow>
    <PropertyRow :label="$t('settings.aboutHomepage')" mono :title="APP_AUTHOR.url">
      <button
        type="button"
        data-testid="about-author-link"
        class="inline-flex min-w-0 items-center gap-1.5 text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        :disabled="opening !== null"
        @click="openProjectLink('author')"
      >
        <GitFork aria-hidden="true" class="size-3.5 shrink-0" />
        <span class="truncate">{{ APP_AUTHOR.url }}</span>
        <ExternalLink aria-hidden="true" class="size-3 shrink-0" />
      </button>
    </PropertyRow>
    <PropertyRow :label="$t('settings.aboutRepository')" mono :title="PROJECT_REPOSITORY_URL">
      <button
        type="button"
        data-testid="about-repository-link"
        class="inline-flex min-w-0 items-center gap-1.5 text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        :disabled="opening !== null"
        @click="openProjectLink('repository')"
      >
        <GitFork aria-hidden="true" class="size-3.5 shrink-0" />
        <span class="truncate">{{ PROJECT_REPOSITORY_URL }}</span>
        <ExternalLink aria-hidden="true" class="size-3 shrink-0" />
      </button>
    </PropertyRow>
  </InspectorSection>

  <InspectorSection
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <div class="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-tint)] text-[var(--accent)]"
        >
          <Star aria-hidden="true" class="size-4" :stroke-width="1.8" />
        </span>
        <p class="min-w-0 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
          {{ $t('settings.aboutStarHint') }}
        </p>
      </div>
      <Button
        data-testid="about-star"
        variant="primary"
        size="sm"
        :loading="opening === 'repository'"
        :disabled="opening !== null"
        @click="openProjectLink('repository')"
      >
        <Star aria-hidden="true" class="size-3.5" />
        {{ $t('settings.aboutStarAction') }}
      </Button>
    </div>
  </InspectorSection>

  <InspectorSection
    data-testid="about-sponsors"
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <div class="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-tint)] text-[var(--accent)]"
        >
          <Heart aria-hidden="true" class="size-4" :stroke-width="1.8" />
        </span>
        <p class="min-w-0 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
          {{ $t('settings.aboutSponsorHint') }}
        </p>
      </div>
      <Button
        data-testid="about-sponsor"
        variant="primary"
        size="sm"
        :loading="openingExternal"
        @click="openExternal(SPONSOR_MAIL)"
      >
        <Heart aria-hidden="true" class="size-3.5" />
        {{ $t('settings.aboutSponsorAction') }}
      </Button>
    </div>
    <div class="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] px-3 py-3">
      <Button
        v-for="sponsor in APP_SPONSORS"
        :key="sponsor.id"
        size="sm"
        :data-testid="'about-sponsor-' + sponsor.id"
        :title="$t(`providerAccounts.sponsorNote.${sponsor.id}`)"
        :disabled="openingExternal"
        @click="openExternal(sponsor.url)"
      >
        {{ sponsor.name }}
      </Button>
    </div>
  </InspectorSection>
</template>
