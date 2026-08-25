<script setup lang="ts">
import { computed } from 'vue'
import { Download, RotateCw, Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type {
  BuiltinSkillHealth,
  BuiltinSkillInfo,
  BuiltinSkillMarketCollection,
  PackageSkillMarketCollection,
  PiPackageInfo,
  PiPackageScope,
  SkillMarketCollection,
  SkillMarketPackage
} from '@shared/ipc/api-types'
import Badge from '@renderer/components/ui/Badge.vue'
import Button from '@renderer/components/ui/Button.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { MARKET_PACKAGE_DESCRIPTION_KEYS } from '@renderer/i18n/marketplace'

const props = defineProps<{
  collection: SkillMarketCollection
  packages: PiPackageInfo[]
  scope: PiPackageScope
  query: string
  installKey: string | null
  removeKey: string | null
}>()

const emit = defineEmits<{
  installPackages: [key: string, packages: SkillMarketPackage[]]
  removePackages: [key: string, packages: SkillMarketPackage[]]
  installBuiltin: [collection: BuiltinSkillMarketCollection, skills: BuiltinSkillInfo[]]
  updateBuiltin: [collection: BuiltinSkillMarketCollection, skill: BuiltinSkillInfo]
  uninstallBuiltin: [collection: BuiltinSkillMarketCollection, skills: BuiltinSkillInfo[]]
}>()

const { t } = useI18n()

const visibleBuiltinSkills = computed(() => {
  const collection = props.collection
  if (!isBuiltinCollection(collection)) return []
  const q = props.query.trim().toLowerCase()
  if (!q) return collection.skills
  return collection.skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.category.includes(q) ||
      collection.author.toLowerCase().includes(q) ||
      collection.name.toLowerCase().includes(q)
  )
})

function isBuiltinCollection(
  collection: SkillMarketCollection
): collection is BuiltinSkillMarketCollection {
  return collection.kind === 'builtin-skills'
}

function isPackageCollection(
  collection: SkillMarketCollection
): collection is PackageSkillMarketCollection {
  return collection.kind !== 'builtin-skills'
}

function currentInstallation(skill: BuiltinSkillInfo) {
  return skill.installations.find((installation) => installation.scope === props.scope)
}

function builtinSkillOwned(skill: BuiltinSkillInfo): boolean {
  return Boolean(currentInstallation(skill)?.owned)
}

function builtinSkillHealth(skill: BuiltinSkillInfo): BuiltinSkillHealth {
  return currentInstallation(skill)?.health ?? 'not-installed'
}

function installedMarketPackage(pkg: SkillMarketPackage): PiPackageInfo | undefined {
  return (
    props.packages.find(
      (installed) => installed.scope === props.scope && installed.source === pkg.source
    ) ??
    props.packages.find(
      (installed) => installed.scope === props.scope && installed.name === pkg.name
    )
  )
}

function marketPackageInstalled(pkg: SkillMarketPackage): boolean {
  return Boolean(installedMarketPackage(pkg)?.registered)
}

function marketPackageVersion(pkg: SkillMarketPackage): string | null {
  return installedMarketPackage(pkg)?.version ?? null
}

function installedCount(collection: SkillMarketCollection): number {
  return isBuiltinCollection(collection)
    ? collection.skills.filter(builtinSkillOwned).length
    : collection.packages.filter(marketPackageInstalled).length
}

function itemCount(collection: SkillMarketCollection): number {
  return isBuiltinCollection(collection) ? collection.skills.length : collection.packages.length
}

function hasMissing(collection: SkillMarketCollection): boolean {
  return installedCount(collection) < itemCount(collection)
}

function isInstallDisabled(key: string): boolean {
  return props.removeKey !== null || (props.installKey !== null && props.installKey !== key)
}

function isRemoveDisabled(key: string): boolean {
  return props.installKey !== null || (props.removeKey !== null && props.removeKey !== key)
}

function collectionTitle(collection: SkillMarketCollection): string {
  if (isBuiltinCollection(collection)) return collection.displayName
  if (collection.id === 'core-development') return t('skills.marketCoreTitle')
  if (collection.id === 'agent-architecture') return t('skills.marketAgentTitle')
  if (collection.id === 'curated-extensions') return t('skills.marketCuratedTitle')
  return collection.id
}

function collectionSummary(collection: SkillMarketCollection): string {
  if (isBuiltinCollection(collection)) {
    return `${collection.name} · ${collection.author} · ${collection.repository}`
  }
  if (collection.id === 'core-development') return t('skills.marketCoreSummary')
  if (collection.id === 'agent-architecture') return t('skills.marketAgentSummary')
  if (collection.id === 'curated-extensions') return t('skills.marketCuratedSummary')
  return ''
}

function collectionKindLabel(collection: SkillMarketCollection): string {
  if (isBuiltinCollection(collection)) return t('skills.marketBuiltin')
  return collection.kind === 'bundle' ? t('skills.marketBundle') : t('skills.marketGuide')
}

function collectionKindTone(collection: SkillMarketCollection): 'muted' | 'success' | 'accent' {
  if (isBuiltinCollection(collection)) return 'success'
  return collection.kind === 'bundle' ? 'accent' : 'muted'
}

function builtinHealthLabel(health: BuiltinSkillHealth): string {
  const suffix = health.replace(/(^|-)(\w)/g, (_, _dash, letter) => letter.toUpperCase())
  return t(`skills.builtinHealth${suffix}`)
}

function builtinHealthTone(
  health: BuiltinSkillHealth
): 'muted' | 'success' | 'warning' | 'error' | 'accent' {
  if (health === 'healthy') return 'success'
  if (health === 'not-installed') return 'muted'
  if (health === 'update-available') return 'accent'
  if (health === 'missing' || health === 'corrupted') return 'error'
  return 'warning'
}

function marketPackageDescription(pkg: SkillMarketPackage): string {
  const key = MARKET_PACKAGE_DESCRIPTION_KEYS[pkg.source]
  return key ? t(key) : pkg.description || pkg.source
}
</script>

<template>
  <div
    class="flex min-h-[54px] shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-1.5"
  >
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <h2 class="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
          {{ collectionTitle(collection) }}
        </h2>
        <Badge :tone="collectionKindTone(collection)">
          {{ collectionKindLabel(collection) }}
        </Badge>
      </div>
      <p class="truncate text-[10.5px] text-[var(--text-tertiary)]">
        {{ collectionSummary(collection) }}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      <template v-if="isBuiltinCollection(collection)">
        <Button
          v-if="collection.skills.some(builtinSkillOwned)"
          variant="danger"
          size="sm"
          :loading="removeKey === collection.id"
          :disabled="isRemoveDisabled(collection.id)"
          @click="emit('uninstallBuiltin', collection, collection.skills)"
        >
          <Trash2 class="size-3.5" />
          {{ $t('skills.builtinRemoveAll') }}
        </Button>
        <Button
          v-if="hasMissing(collection)"
          variant="primary"
          size="sm"
          :loading="installKey === collection.id"
          :disabled="isInstallDisabled(collection.id)"
          @click="emit('installBuiltin', collection, collection.skills)"
        >
          <Download class="size-3.5" />
          {{ $t('skills.builtinInstallAll') }}
        </Button>
      </template>
      <template v-else-if="isPackageCollection(collection)">
        <Button
          v-if="collection.kind === 'bundle' && installedCount(collection) > 0"
          variant="danger"
          size="sm"
          :loading="removeKey === collection.id"
          :disabled="isRemoveDisabled(collection.id)"
          @click="emit('removePackages', collection.id, collection.packages)"
        >
          <Trash2 class="size-3.5" />
          {{ $t('skills.removeInstalled') }}
        </Button>
        <Button
          v-if="collection.kind === 'bundle' && hasMissing(collection)"
          variant="primary"
          size="sm"
          :loading="installKey === collection.id"
          :disabled="isInstallDisabled(collection.id)"
          @click="emit('installPackages', collection.id, collection.packages)"
        >
          <Download class="size-3.5" />
          {{ $t('skills.installMissing') }}
        </Button>
      </template>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    <template v-if="isBuiltinCollection(collection)">
      <InspectorSection>
        <template #title>{{ $t('skills.builtinCollection') }}</template>
        <PropertyRow :label="$t('skills.builtinAuthor')">{{ collection.author }}</PropertyRow>
        <PropertyRow :label="$t('skills.colSource')">{{ $t('skills.builtinSource') }}</PropertyRow>
        <PropertyRow :label="$t('skills.builtinRepository')" mono>
          {{ collection.repository }}
        </PropertyRow>
        <PropertyRow :label="$t('skills.builtinLicense')" mono>
          {{ collection.license }}
        </PropertyRow>
        <PropertyRow :label="$t('skills.builtinVersion')" mono>
          {{ collection.commit.slice(0, 12) }}
        </PropertyRow>
        <PropertyRow :label="$t('skills.packageScope')">
          {{
            scope === 'global' ? $t('skills.packageScopeGlobal') : $t('skills.packageScopeProject')
          }}
        </PropertyRow>
      </InspectorSection>
      <div class="my-1 h-px bg-[var(--border-subtle)]" />
      <InspectorSection>
        <template #title>
          {{ $t('skills.marketSkills') }}
          <span class="ml-1 font-normal text-[var(--text-tertiary)]">
            {{ installedCount(collection) }}/{{ collection.skills.length }}
          </span>
        </template>
        <div class="divide-y divide-[var(--border-subtle)]">
          <div
            v-for="skill in visibleBuiltinSkills"
            :key="skill.id"
            :data-testid="`builtin-skill-${skill.id}`"
            class="flex min-h-[68px] items-center justify-between gap-3 px-3 py-2.5"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                  {{ skill.name }}
                </span>
                <Badge tone="muted">{{ skill.category }}</Badge>
                <Badge :tone="builtinHealthTone(builtinSkillHealth(skill))">
                  {{ builtinHealthLabel(builtinSkillHealth(skill)) }}
                </Badge>
              </div>
              <p
                class="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-[var(--text-tertiary)]"
              >
                {{ skill.description }}
              </p>
              <p
                class="mt-1 truncate font-[family-name:var(--font-mono)] text-[9.5px] text-[var(--text-disabled)]"
              >
                {{ skill.sourcePath }} · {{ skill.resources.length }}
                {{ $t('skills.resourcesUnit') }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <Button
                v-if="!builtinSkillOwned(skill)"
                variant="secondary"
                size="sm"
                :loading="installKey === skill.id"
                :disabled="isInstallDisabled(skill.id)"
                @click="emit('installBuiltin', collection, [skill])"
              >
                <Download class="size-3.5" />
                {{
                  builtinSkillHealth(skill) === 'conflict'
                    ? $t('skills.builtinResolveConflict')
                    : $t('skills.install')
                }}
              </Button>
              <Button
                v-if="builtinSkillOwned(skill) && builtinSkillHealth(skill) !== 'healthy'"
                variant="secondary"
                size="sm"
                :loading="installKey === skill.id"
                :disabled="isInstallDisabled(skill.id)"
                @click="emit('updateBuiltin', collection, skill)"
              >
                <RotateCw class="size-3.5" />
                {{
                  builtinSkillHealth(skill) === 'update-available'
                    ? $t('skills.capabilityUpdate')
                    : $t('skills.reinstallPackage')
                }}
              </Button>
              <Button
                v-if="builtinSkillOwned(skill)"
                variant="danger"
                size="sm"
                :loading="removeKey === skill.id"
                :disabled="isRemoveDisabled(skill.id)"
                @click="emit('uninstallBuiltin', collection, [skill])"
              >
                <Trash2 class="size-3.5" />
                {{ $t('skills.uninstallSkill') }}
              </Button>
            </div>
          </div>
        </div>
      </InspectorSection>
    </template>
    <InspectorSection v-else-if="isPackageCollection(collection)">
      <template #title>
        {{ $t('skills.marketPackages') }}
        <span class="ml-1 font-normal text-[var(--text-tertiary)]">
          {{ installedCount(collection) }}/{{ collection.packages.length }}
        </span>
      </template>
      <div class="divide-y divide-[var(--border-subtle)]">
        <div
          v-for="pkg in collection.packages"
          :key="pkg.source"
          class="flex min-h-[52px] items-center justify-between gap-3 px-3 py-2"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                {{ pkg.name }}
              </span>
              <Badge v-if="marketPackageInstalled(pkg)" tone="success">
                {{
                  marketPackageVersion(pkg)
                    ? `v${marketPackageVersion(pkg)}`
                    : $t('common.installed')
                }}
              </Badge>
            </div>
            <p
              class="truncate font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
            >
              {{ marketPackageDescription(pkg) }}
            </p>
          </div>
          <Button
            v-if="!marketPackageInstalled(pkg)"
            variant="secondary"
            size="sm"
            :loading="installKey === pkg.source"
            :disabled="isInstallDisabled(pkg.source)"
            @click="emit('installPackages', pkg.source, [pkg])"
          >
            <Download class="size-3.5" />
            {{ $t('skills.install') }}
          </Button>
          <Button
            v-else
            variant="danger"
            size="sm"
            :loading="removeKey === pkg.source"
            :disabled="isRemoveDisabled(pkg.source)"
            @click="emit('removePackages', pkg.source, [pkg])"
          >
            <Trash2 class="size-3.5" />
            {{ $t('skills.removePackage') }}
          </Button>
        </div>
      </div>
    </InspectorSection>
  </div>
</template>
