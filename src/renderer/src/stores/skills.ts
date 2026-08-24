import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  BuiltinSkillActionResult,
  BuiltinSkillMutationTarget,
  PiPackageActionResult,
  PiPackageCleanupPlan,
  PiPackageCleanupResult,
  PiPackageInfo,
  PiPackagePermission,
  PiPackageScope,
  PiPackageTarget,
  SkillInfo,
  SkillMarketCollection
} from '@shared/ipc/api-types'
import { callApi, getApi, getErrorPayload } from '@renderer/composables/useApi'
import type {
  CapabilityActionResult,
  CapabilityDescriptor,
  CapabilityMutationProgress
} from '@shared/capabilities/types'
import type { AppErrorPayload } from '@shared/types/errors'
import { useWorkspaceStore } from './workspace'

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<SkillInfo[]>([])
  const packages = ref<PiPackageInfo[]>([])
  const market = ref<SkillMarketCollection[]>([])
  const capabilities = ref<CapabilityDescriptor[]>([])
  const capabilityProgress = ref<Record<string, CapabilityMutationProgress>>({})
  const capabilityErrors = ref<Record<string, AppErrorPayload>>({})
  const packageResults = ref<PiPackageActionResult[]>([])
  const builtinSkillResults = ref<BuiltinSkillActionResult[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedPath = ref<string | null>(null)
  const detailContent = ref<string>('')
  /** mtime of the currently loaded skill markdown file (for conflict detection). */
  const detailMtime = ref<number | null>(null)
  const detailFilePath = ref<string | null>(null)
  const detailLoading = ref(false)
  const featuredSkills = computed(() => capabilities.value.filter((entry) => entry.featured))
  const installingIds = computed(() =>
    Object.values(capabilityProgress.value)
      .filter((progress) => ['resolving', 'installing', 'validating'].includes(progress.phase))
      .map((progress) => progress.skillId)
  )

  getApi().on('capability-progress', (progress) => {
    capabilityProgress.value = {
      ...capabilityProgress.value,
      [progress.skillId]: progress
    }
  })

  async function fetchList() {
    loading.value = true
    error.value = null
    try {
      const projectRoot = useWorkspaceStore().currentCwd
      const [skillList, packageList, marketList, capabilityList] = await Promise.all([
        callApi(() => getApi().skills.list(projectRoot)),
        callApi(() => getApi().skills.packages(projectRoot)),
        callApi(() => getApi().skills.market(projectRoot)),
        callApi(() => getApi().capabilities.list())
      ])
      skills.value = skillList
      packages.value = packageList
      market.value = marketList
      capabilities.value = capabilityList
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      const projectRoot = useWorkspaceStore().currentCwd
      const [skillList, packageList, marketList, capabilityList] = await Promise.all([
        callApi(() => getApi().skills.list(projectRoot)),
        callApi(() => getApi().skills.packages(projectRoot)),
        callApi(() => getApi().skills.market(projectRoot)),
        callApi(() => getApi().capabilities.list())
      ])
      skills.value = skillList
      packages.value = packageList
      market.value = marketList
      capabilities.value = capabilityList
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  async function loadDetail(skillPath: string) {
    selectedPath.value = skillPath
    detailLoading.value = true
    detailContent.value = ''
    detailMtime.value = null
    detailFilePath.value = null
    try {
      const candidates = ['SKILL.md', 'README.md', 'skill.md', 'readme.md']
      let content = ''
      let mtime: number | null = null
      let filePath: string | null = null
      for (const name of candidates) {
        try {
          const p = `${skillPath.replace(/\/$/, '')}/${name}`
          const result = await callApi(() => getApi().skills.read(p))
          if (result.content) {
            content = result.content
            mtime = result.mtime
            filePath = p
            break
          }
        } catch {
          /* try next */
        }
      }
      detailContent.value = content || '(No SKILL.md / README.md found)'
      detailMtime.value = mtime
      detailFilePath.value = filePath
    } catch (e) {
      detailContent.value = (e as { message?: string }).message ?? String(e)
    } finally {
      detailLoading.value = false
    }
  }

  async function remove(skillPath: string) {
    await callApi(() => getApi().skills.delete(skillPath))
    if (selectedPath.value === skillPath) {
      selectedPath.value = null
      detailContent.value = ''
      detailMtime.value = null
      detailFilePath.value = null
    }
    await fetchList()
  }

  function targetFor(source: string, scope: PiPackageScope = 'global'): PiPackageTarget {
    const projectRoot = scope === 'project' ? useWorkspaceStore().currentCwd : null
    return { source, scope, projectRoot }
  }

  async function installPackages(
    sources: string[],
    scope: PiPackageScope = 'global'
  ): Promise<PiPackageActionResult[]> {
    const results = await callApi(() =>
      getApi().skills.installPackages(sources.map((source) => targetFor(source, scope)))
    )
    packageResults.value = results
    await refresh()
    return results
  }

  async function removePackages(packageIds: string[]): Promise<PiPackageActionResult[]> {
    const targets = packageIds
      .map((id) => packages.value.find((pkg) => pkg.id === id || pkg.source === id))
      .filter((pkg): pkg is PiPackageInfo => Boolean(pkg))
      .map((pkg) => targetForPackage(pkg))
    const results = await callApi(() => getApi().skills.removePackages(targets))
    packageResults.value = results
    await refresh()
    return results
  }

  async function removePackage(pkg: PiPackageInfo): Promise<PiPackageActionResult> {
    const result = await callApi(() => getApi().skills.removePackage(targetForPackage(pkg)))
    packageResults.value = [result]
    await refresh()
    return result
  }

  async function repairPackage(pkg: PiPackageInfo): Promise<PiPackageActionResult> {
    const result = await callApi(() => getApi().skills.repairPackage(targetForPackage(pkg)))
    packageResults.value = [result]
    await refresh()
    return result
  }

  async function registerPackage(pkg: PiPackageInfo): Promise<PiPackageActionResult> {
    const result = await callApi(() => getApi().skills.registerPackage(targetForPackage(pkg)))
    packageResults.value = [result]
    await refresh()
    return result
  }

  async function deleteOrphanPackage(pkg: PiPackageInfo): Promise<PiPackageActionResult> {
    const result = await callApi(() => getApi().skills.deleteOrphanPackage(targetForPackage(pkg)))
    packageResults.value = [result]
    await refresh()
    return result
  }

  async function getCleanupPlan(): Promise<PiPackageCleanupPlan> {
    return callApi(() => getApi().skills.cleanupPlan(useWorkspaceStore().currentCwd))
  }

  async function cleanupThirdParty(): Promise<PiPackageCleanupResult> {
    const result = await callApi(() =>
      getApi().skills.cleanupThirdParty(useWorkspaceStore().currentCwd)
    )
    packageResults.value = result.packageResults
    await refresh()
    return result
  }

  async function repairPermissions(): Promise<PiPackagePermission[]> {
    const result = await callApi(() =>
      getApi().skills.repairPermissions(useWorkspaceStore().currentCwd)
    )
    await refresh()
    return result
  }

  function builtinTarget(
    collectionId: string,
    skillIds: string[],
    scope: PiPackageScope,
    overwrite = false
  ): BuiltinSkillMutationTarget {
    return {
      collectionId,
      skillIds,
      scope,
      projectRoot: scope === 'project' ? useWorkspaceStore().currentCwd : null,
      overwrite
    }
  }

  async function installBuiltinSkills(
    collectionId: string,
    skillIds: string[],
    scope: PiPackageScope,
    overwrite = false
  ): Promise<BuiltinSkillActionResult[]> {
    const results = await callApi(() =>
      getApi().skills.installBuiltinSkills(builtinTarget(collectionId, skillIds, scope, overwrite))
    )
    builtinSkillResults.value = results
    await refresh()
    return results
  }

  async function updateBuiltinSkills(
    collectionId: string,
    skillIds: string[],
    scope: PiPackageScope,
    overwrite = true
  ): Promise<BuiltinSkillActionResult[]> {
    const results = await callApi(() =>
      getApi().skills.updateBuiltinSkills(builtinTarget(collectionId, skillIds, scope, overwrite))
    )
    builtinSkillResults.value = results
    await refresh()
    return results
  }

  async function uninstallBuiltinSkills(
    collectionId: string,
    skillIds: string[],
    scope: PiPackageScope
  ): Promise<BuiltinSkillActionResult[]> {
    const results = await callApi(() =>
      getApi().skills.uninstallBuiltinSkills(builtinTarget(collectionId, skillIds, scope))
    )
    builtinSkillResults.value = results
    await refresh()
    return results
  }

  async function mutateCapability(
    skillId: string,
    action: () => Promise<CapabilityActionResult>
  ): Promise<CapabilityActionResult> {
    const existing = capabilityProgress.value[skillId]
    capabilityProgress.value = {
      ...capabilityProgress.value,
      [skillId]: {
        skillId,
        action: existing?.action ?? 'install',
        phase: 'resolving'
      }
    }
    const errors = { ...capabilityErrors.value }
    delete errors[skillId]
    capabilityErrors.value = errors
    try {
      const result = await callApi(action)
      await refresh()
      return result
    } catch (error) {
      const payload = getErrorPayload(error)
      capabilityErrors.value = { ...capabilityErrors.value, [skillId]: payload }
      const progress = capabilityProgress.value[skillId]
      capabilityProgress.value = {
        ...capabilityProgress.value,
        [skillId]: {
          ...progress,
          skillId,
          action: progress?.action ?? 'install',
          phase: 'failed',
          message: payload.message
        }
      }
      throw payload
    }
  }

  function installSkill(skillId: string) {
    capabilityProgress.value = {
      ...capabilityProgress.value,
      [skillId]: { skillId, action: 'install', phase: 'resolving' }
    }
    return mutateCapability(skillId, () => getApi().capabilities.installSkill(skillId))
  }

  function updateSkill(skillId: string) {
    capabilityProgress.value = {
      ...capabilityProgress.value,
      [skillId]: { skillId, action: 'update', phase: 'resolving' }
    }
    return mutateCapability(skillId, () => getApi().capabilities.updateSkill(skillId))
  }

  function uninstallSkill(skillId: string) {
    capabilityProgress.value = {
      ...capabilityProgress.value,
      [skillId]: { skillId, action: 'uninstall', phase: 'resolving' }
    }
    return mutateCapability(skillId, () => getApi().capabilities.uninstallSkill(skillId))
  }

  function setSkillEnabled(skillId: string, enabled: boolean) {
    capabilityProgress.value = {
      ...capabilityProgress.value,
      [skillId]: {
        skillId,
        action: enabled ? 'enable' : 'disable',
        phase: 'resolving'
      }
    }
    return mutateCapability(skillId, () => getApi().capabilities.setSkillEnabled(skillId, enabled))
  }

  return {
    skills,
    packages,
    market,
    capabilities,
    featuredSkills,
    capabilityProgress,
    capabilityErrors,
    packageResults,
    builtinSkillResults,
    installingIds,
    loading,
    error,
    selectedPath,
    detailContent,
    detailMtime,
    detailFilePath,
    detailLoading,
    fetchList,
    refresh,
    loadDetail,
    remove,
    installPackages,
    removePackages,
    removePackage,
    repairPackage,
    registerPackage,
    deleteOrphanPackage,
    getCleanupPlan,
    cleanupThirdParty,
    repairPermissions,
    installBuiltinSkills,
    updateBuiltinSkills,
    uninstallBuiltinSkills,
    installSkill,
    updateSkill,
    uninstallSkill,
    setSkillEnabled
  }
})

function targetForPackage(pkg: PiPackageInfo): PiPackageTarget {
  return { source: pkg.source, scope: pkg.scope, projectRoot: pkg.projectRoot }
}
