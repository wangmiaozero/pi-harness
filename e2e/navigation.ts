import { expect, type Page } from '@playwright/test'

/** Navigate through the user-visible overflow menu. */
export async function openOverflowPage(
  page: Page,
  destination: 'git' | 'ai-sessions' | 'skills'
): Promise<void> {
  const menu = page.getByTestId('navigation-more-menu')
  if (!(await menu.isVisible())) await page.getByTestId('navigation-more').click()
  await expect(menu).toBeVisible()
  await menu.locator(`a[href="#/${destination}"]`).click()
  await expect(page).toHaveURL(new RegExp(`#/${destination}(?:[/?]|$)`))
  await expect(menu).toBeHidden()
}
