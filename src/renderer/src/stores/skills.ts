import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  PiPackageActionResult,
  PiPackageInfo,
  SkillInfo,
  SkillMarketCollection
} from '@shared/ipc/api-types'
import { callApi, getApi } from '@renderer/composables/useApi'

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<SkillInfo[]>([])
  const packages = ref<PiPackageInfo[]>([])
  const market = ref<SkillMarketCollection[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedPath = ref<string | null>(null)
  const detailContent = ref<string>('')
  /** mtime of the currently loaded skill markdown file (for conflict detection). */
  const detailMtime = ref<number | null>(null)
  const detailFilePath = ref<string | null>(null)
  const detailLoading = ref(false)

  async function fetchList() {
    loading.value = true
    error.value = null
    try {
      const [skillList, packageList, marketList] = await Promise.all([
        callApi(() => getApi().skills.list()),
        callApi(() => getApi().skills.packages()),
        callApi(() => getApi().skills.market())
      ])
      skills.value = skillList
      packages.value = packageList
      market.value = marketList
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
      const [skillList, packageList, marketList] = await Promise.all([
        callApi(() => getApi().skills.refresh()),
        callApi(() => getApi().skills.packages()),
        callApi(() => getApi().skills.market())
      ])
      skills.value = skillList
      packages.value = packageList
      market.value = marketList
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

  return {
    skills,
    packages,
    market,
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
    removePackage
  }
})
