import { expect, it } from 'vitest'
import { APP_SPONSORS, SPONSOR_MAIL, showSponsorSection, sponsorsForQuery } from './sponsors'

it('keeps the sponsor mail on this project and lists the published sponsors', () => {
  expect(SPONSOR_MAIL).toBe('mailto:tuziling84@gmail.com?subject=Sponsoring%20Pi-Harness')
  expect(APP_SPONSORS.map((sponsor) => sponsor.id)).toEqual(['infistar', 'tokenarmy', 'workbuddy'])
  expect(APP_SPONSORS.every((sponsor) => sponsor.url.startsWith('https://'))).toBe(true)
  expect(sponsorsForQuery('token').map((sponsor) => sponsor.id)).toEqual(['tokenarmy'])
  expect(showSponsorSection('')).toBe(true)
  expect(showSponsorSection('赞助')).toBe(true)
  expect(showSponsorSection('deepseek')).toBe(false)
})
