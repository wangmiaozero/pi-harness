import { PROVIDER_PRESETS } from '../constants/provider-presets'
import type { ProviderProfile } from '../types/domain'

export type OfficialModelGroup = 'claude' | 'gemini'

export const officialModelGroups = {
  claude: { name: 'Claude', preset: PROVIDER_PRESETS.find((item) => item.id === 'anthropic')! },
  gemini: { name: 'Gemini', preset: PROVIDER_PRESETS.find((item) => item.id === 'google')! }
}

export function getOfficialModelGroup(
  provider: Pick<ProviderProfile, 'baseUrl' | 'protocol'>
): OfficialModelGroup | undefined {
  const url = URL.parse(provider.baseUrl)
  return (Object.keys(officialModelGroups) as OfficialModelGroup[]).find((group) => {
    const { preset } = officialModelGroups[group]
    return (
      provider.protocol === preset.protocol && url?.origin === new URL(preset.defaultBaseUrl).origin
    )
  })
}

export function officialModelRank(group: OfficialModelGroup, modelId: string): number {
  const { models } = officialModelGroups[group].preset
  const index = models.findIndex(({ id, aliases }) => id === modelId || aliases?.includes(modelId))
  return index < 0 ? models.length : index
}
