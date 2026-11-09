import { getApi } from '@renderer/composables/useApi'
import { setInstalledPetIds, setInstalledThemeAssets } from '@renderer/utils/visual-skin'
import type { MarketInstalled } from '@shared/market/types'

export function publishInstalledCatalog(installed: MarketInstalled): void {
  setInstalledThemeAssets(
    installed.themes.map((theme) => ({
      packId: theme.packId,
      styles: theme.manifest?.variants.flatMap((variant) => [variant.id, variant.skinId]) ?? [],
      cssImages: Object.assign(
        {},
        ...(theme.manifest?.variants.map((variant) => variant.cssImages ?? {}) ?? [])
      )
    }))
  )
  setInstalledPetIds(
    installed.pets.map((pet) => pet.petId).filter((id): id is string => Boolean(id))
  )
}

export async function reloadInstalledCatalog(): Promise<MarketInstalled> {
  const installed = await getApi().market.installed()
  publishInstalledCatalog(installed)
  return installed
}
