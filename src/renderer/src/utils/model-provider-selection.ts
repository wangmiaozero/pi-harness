export function chooseModelCreateProvider<T extends { id: string }>(
  providers: readonly T[],
  providerFilter: string | 'all'
): T | undefined {
  if (providerFilter !== 'all') {
    const selected = providers.find((provider) => provider.id === providerFilter)
    if (selected) return selected
  }
  return providers[0]
}
