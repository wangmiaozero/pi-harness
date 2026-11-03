import type { Page } from '@playwright/test'

/** Navigate through the user-visible overflow menu. */
export async function openOverflowPage(
  page: Page,
  destination: 'git' | 'ai-sessions' | 'skills'
): Promise<void> {
  await page.getByTestId('navigation-more').click()
  await page.getByTestId('navigation-more-menu').locator(`a[href="#/${destination}"]`).click()
}
