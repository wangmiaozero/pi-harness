<script setup lang="ts">
import { ref } from 'vue'
import { ExternalLink, GitFork, Mail, Star, UserRound } from '@lucide/vue'
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

const { t } = useI18n()
const opening = ref<ProjectLinkTarget | null>(null)

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
</template>
