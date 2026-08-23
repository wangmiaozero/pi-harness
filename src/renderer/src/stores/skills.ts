import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  PiPackageActionResult,
  PiPackageInfo,
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

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<SkillInfo[]>([])
  const packages = ref<PiPackageInfo[]>([])
  const market = ref<SkillMarketCollection[]>([])
  const capabilities = ref<CapabilityDescriptor[]>([])
  const capabilityProgress = ref<Record<string, CapabilityMutationProgress>>({})
  const capabilityErrors = ref<Record<string, AppErrorPayload>>({})
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
      const [skillList, packageList, marketList, capabilityList] = await Promise.all([
        callApi(() => getApi().skills.list()),
        callApi(() => getApi().skills.packages()),
        callApi(() => getApi().skills.market()),
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
      const [skillList, packageList, marketList, capabilityList] = await Promise.all([
        callApi(() => getApi().skills.refresh()),
        callApi(() => getApi().skills.packages()),
        callApi(() => getApi().skills.market()),
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

  async function installPackages(sources: string[]): Promise<PiPackageActionResult[]> {
    const results = await callApi(() => getApi().skills.installPackages(sources))
    await refresh()
    return results
  }

  async function removePackages(sources: string[]): Promise<PiPackageActionResult[]> {
    const results = await callApi(() => getApi().skills.removePackages(sources))
    await refresh()
    return results
  }

  async function removePackage(source: string): Promise<PiPackageActionResult> {
    const result = await callApi(() => getApi().skills.removePackage(source))
    await refresh()
    return result
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
    installSkill,
    updateSkill,
    uninstallSkill,
    setSkillEnabled
  }
})
