/** People who want to sponsor Pi-Harness write to the maintainer. */
export const SPONSOR_MAIL = 'mailto:tuziling84@gmail.com?subject=Sponsoring%20Pi-Harness'

/** Sponsors already listed in the project README. Tiles open these pages. */
export const APP_SPONSORS = [
  {
    id: 'infistar',
    name: 'Infistar.cc',
    url: 'https://infistar.cc/register?aff=S26RFM4B&ref_source=link'
  },
  {
    id: 'tokenarmy',
    name: 'TokenArmy',
    url: 'https://tokenarmy.shop/r/TA-7FBJU-NUSUC'
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    url: 'https://cloud.tencent.com/act/cps/redirect?redirect=6871&cps_key=ece2099a1da90c2f7a4a4c437ad623f8&from=console'
  }
] as const

export type AppSponsorId = (typeof APP_SPONSORS)[number]['id']

export function sponsorsForQuery(query: string): readonly (typeof APP_SPONSORS)[number][] {
  const needle = query.trim().toLowerCase()
  if (!needle) return APP_SPONSORS
  return APP_SPONSORS.filter(
    (sponsor) => sponsor.id.includes(needle) || sponsor.name.toLowerCase().includes(needle)
  )
}

export function showSponsorSection(query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (sponsorsForQuery(needle).length > 0) return true
  return needle.includes('赞助') || needle.includes('sponsor') || needle.includes('partner')
}
