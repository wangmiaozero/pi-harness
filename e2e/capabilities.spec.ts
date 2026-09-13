import { test, expect } from './fixtures'
import { IPC_INVOKE } from '../src/shared/ipc/channels'
import type { ElectronApplication } from '@playwright/test'

async function mockEmptyRegistry(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => ({
      ok: true,
      data: { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0, fetchedAt: Date.now() }
    }))
  }, IPC_INVOKE.packagesRegistrySearch)
}

test.describe('Capabilities', () => {
  test('shows and switches the selected capability view tab', async ({ electronApp, page }) => {
    await mockEmptyRegistry(electronApp)
    await page.locator('a[href="#/skills"]').click()

    const officialTab = page.getByRole('tab', { name: /官方市场|Official Market/, exact: true })
    const skillsTab = page.getByRole('tab', { name: /技能|Skills/, exact: true })
    const packagesTab = page.getByRole('tab', { name: /已安装|Installed/, exact: true })
    const marketTab = page.getByRole('tab', { name: /精选|Featured/, exact: true })

    await expect(officialTab).toHaveAttribute('aria-selected', 'true')
    await expect(skillsTab).toHaveAttribute('aria-selected', 'false')
    await expect(packagesTab).toHaveAttribute('aria-selected', 'false')

    const [selectedStyle, idleStyle] = await Promise.all([
      officialTab.evaluate((element) => {
        const style = getComputedStyle(element)
        const labelStyle = getComputedStyle(element.querySelector('[data-tab-label]')!)
        return {
          backgroundColor: style.backgroundColor,
          color: labelStyle.color,
          boxShadow: style.boxShadow
        }
      }),
      packagesTab.evaluate((element) => {
        const style = getComputedStyle(element)
        const labelStyle = getComputedStyle(element.querySelector('[data-tab-label]')!)
        return {
          backgroundColor: style.backgroundColor,
          color: labelStyle.color,
          boxShadow: style.boxShadow
        }
      })
    ])
    expect(selectedStyle.backgroundColor).not.toBe(idleStyle.backgroundColor)
    expect(selectedStyle.color).not.toBe(idleStyle.color)
    expect(selectedStyle.boxShadow).not.toBe('none')

    await packagesTab.click()
    await expect(packagesTab).toHaveAttribute('aria-selected', 'true')
    await expect(skillsTab).toHaveAttribute('aria-selected', 'false')

    await marketTab.click()
    await expect(marketTab).toHaveAttribute('aria-selected', 'true')
    await expect(packagesTab).toHaveAttribute('aria-selected', 'false')
  })

  test('installs a featured skill through the trusted capability flow', async ({
    electronApp,
    page
  }) => {
    await mockEmptyRegistry(electronApp)
    await page.locator('a[href="#/skills"]').click()
    await page.getByRole('tab', { name: /技能|Skills/, exact: true }).click()
    const card = page.getByTestId('featured-capability-odai')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Odai')
    await expect(card).toContainText(/未安装|Not installed/)

    await card.click()
    await page.getByTestId('featured-capability-install').click()
    await expect(card).toContainText(/已安装|Installed/, { timeout: 15_000 })

    const state = await page.evaluate(async () => {
      const [capabilities, skills] = await Promise.all([
        window.piSwitch.capabilities.list(),
        window.piSwitch.skills.refresh()
      ])
      return {
        capability: capabilities.find((entry) => entry.id === 'odai'),
        discovered: skills.some((skill) => skill.name === 'odai')
      }
    })
    expect(state.capability).toMatchObject({ installed: true, enabled: true, status: 'installed' })
    expect(state.discovered).toBe(true)
  })

  test('keeps Native Pi default and never auto-installs recommended add-ons', async ({
    electronApp,
    page
  }) => {
    await mockEmptyRegistry(electronApp)
    await page.locator('a[href="#/skills"]').click()
    await page.getByRole('tab', { name: /技能|Skills/, exact: true }).click()

    const cards = page.locator('[data-testid^="featured-capability-"]')
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0)).toContainText('Native Pi')
    await expect(cards.nth(1)).toContainText('Superpowers')
    await expect(cards.nth(1)).toContainText(/推荐|Recommended/)
    await expect(cards.nth(2)).toContainText('Odai')

    const state = await page.evaluate(async () => {
      const [capabilities, packages] = await Promise.all([
        window.piSwitch.capabilities.list(),
        window.piSwitch.skills.packages()
      ])
      return {
        native: capabilities.find((entry) => entry.id === 'native-pi'),
        superpowers: capabilities.find((entry) => entry.id === 'superpowers'),
        odai: capabilities.find((entry) => entry.id === 'odai'),
        superpowersPackage: packages.find((pkg) => pkg.source === 'git:github.com/obra/superpowers')
      }
    })
    expect(state.native).toMatchObject({ builtin: true, installed: true, enabled: true })
    expect(state.superpowers).toMatchObject({
      recommended: true,
      optional: true,
      installed: false
    })
    expect(state.odai).toMatchObject({ recommended: false, optional: true, installed: false })
    expect(state.superpowersPackage).toBeUndefined()

    await cards.nth(0).click()
    await expect(page.getByTestId('featured-capability-install')).toHaveCount(0)
    await cards.nth(1).click()
    await expect(page.getByTestId('featured-capability-install')).toBeVisible()
    await expect(page.getByText('pi install git:github.com/obra/superpowers')).toBeVisible()
    await page.getByTestId('featured-capability-install').click()
    const confirmation = page.getByRole('dialog')
    await expect(confirmation).toContainText('pi install git:github.com/obra/superpowers')
    await confirmation.getByRole('button', { name: /取消|Cancel/, exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(cards.nth(1)).toContainText(/未安装|Not installed/)
  })

  test('uses the mocked Registry for search, pagination, filters, details, install and update', async ({
    electronApp,
    page
  }) => {
    await electronApp.evaluate(
      ({ ipcMain }, channels) => {
        let installedVersion: string | null = null
        const registryPackage = (name: string, type = 'extension') => ({
          name,
          version: '1.1.0',
          description: 'Mock Pi capability package',
          keywords: ['pi-package'],
          publisher: 'pi-test',
          author: 'Pi Test',
          maintainers: ['pi-test'],
          license: 'MIT',
          homepage: 'https://example.test',
          repository: 'https://example.test/repo',
          npmUrl: `https://www.npmjs.com/package/${name}`,
          publishDate: '2026-01-02T00:00:00.000Z',
          monthlyDownloads: 761_400,
          weeklyDownloads: 101_000,
          types: [type],
          resources: {
            extensions: type === 'extension' ? ['index.ts'] : [],
            skills: type === 'skill' ? ['skills/demo'] : [],
            prompts: [],
            themes: []
          },
          detailStatus: 'loaded',
          detailError: null
        })
        const localPackage = () => ({
          id: 'global:npm:pi-mcp-adapter',
          source: 'npm:pi-mcp-adapter',
          name: 'pi-mcp-adapter',
          sourceType: 'npm',
          scope: 'global',
          projectRoot: null,
          registered: true,
          registryPath: '/tmp/settings.json',
          version: installedVersion,
          description: 'Mock Pi capability package',
          path: '/tmp/pi-mcp-adapter',
          installed: true,
          available: true,
          healthy: true,
          health: 'healthy',
          managed: true,
          resources: { skills: [], prompts: [], extensions: ['index'], themes: [], tools: [] },
          resourceItems: [],
          problems: [],
          permissions: []
        })
        const ok = (data: unknown) => ({ ok: true, data })
        for (const channel of [
          channels.search,
          channels.detail,
          channels.install,
          channels.packages,
          channels.updates,
          channels.update
        ]) {
          ipcMain.removeHandler(channel)
        }
        ipcMain.handle(
          channels.search,
          async (_event, input: { page?: number; query?: string; type?: string }) => {
            if (input.query?.includes('mcp')) {
              await new Promise((resolve) => setTimeout(resolve, 1_000))
            }
            const pageNumber = input.page ?? 1
            const name = input.query?.includes('mcp')
              ? 'pi-mcp-adapter'
              : pageNumber === 2
                ? 'pi-second-page'
                : 'pi-first-page'
            const type = input.type && input.type !== 'all' ? input.type : 'extension'
            return ok({
              items: [registryPackage(name, type)],
              total: 51,
              page: pageNumber,
              pageSize: 50,
              totalPages: 2,
              fetchedAt: Date.now()
            })
          }
        )
        ipcMain.handle(channels.detail, (_event, input: { name: string }) =>
          ok({
            ...registryPackage(input.name),
            latestVersion: '1.1.0',
            dependencies: {},
            peerDependencies: {},
            dist: { tarball: null, shasum: null, integrity: null, unpackedSize: null },
            piManifest: { extensions: ['index.ts'] }
          })
        )
        ipcMain.handle(channels.install, () => {
          installedVersion = '1.0.0'
          return ok([
            {
              source: 'npm:pi-mcp-adapter',
              scope: 'global',
              action: 'install',
              ok: true,
              skipped: false,
              message: 'installed',
              stdout: '',
              stderr: '',
              errorCode: null,
              logs: []
            }
          ])
        })
        ipcMain.handle(channels.packages, () => ok(installedVersion ? [localPackage()] : []))
        ipcMain.handle(channels.updates, () =>
          ok(
            installedVersion
              ? [
                  {
                    packageId: 'global:npm:pi-mcp-adapter',
                    source: 'npm:pi-mcp-adapter',
                    scope: 'global',
                    installedVersion,
                    latestVersion: '1.1.0',
                    updateAvailable: installedVersion === '1.0.0',
                    state: installedVersion === '1.0.0' ? 'update-available' : 'up-to-date',
                    error: null
                  }
                ]
              : []
          )
        )
        ipcMain.handle(channels.update, () => {
          installedVersion = '1.1.0'
          return ok({
            source: 'npm:pi-mcp-adapter',
            scope: 'global',
            action: 'update',
            ok: true,
            skipped: false,
            message: 'updated',
            stdout: '',
            stderr: '',
            errorCode: null,
            logs: []
          })
        })
      },
      {
        search: IPC_INVOKE.packagesRegistrySearch,
        detail: IPC_INVOKE.packagesRegistryDetail,
        install: IPC_INVOKE.skillsInstallPackages,
        packages: IPC_INVOKE.skillsPackages,
        updates: IPC_INVOKE.packagesCheckUpdates,
        update: IPC_INVOKE.packagesUpdate
      }
    )

    await page.locator('a[href="#/skills"]').click()
    await expect(page.getByTestId('official-package-market')).toBeVisible()
    await expect(page.getByTestId('registry-total')).toContainText('51')

    const toolbar = page.locator('.capabilities-toolbar')
    await toolbar.getByRole('button', { name: /技能|Skills/, exact: true }).click()
    await expect(page.getByText(/技能|Skill/, { exact: true }).last()).toBeVisible()
    await toolbar.getByRole('button', { name: /全部|All/, exact: true }).click()

    const search = page.getByPlaceholder(/搜索能力包|Search packages/)
    const searchChrome = await search.evaluate((input) => {
      const field = input.closest('label')
      if (!field) throw new Error('Search field shell is missing')
      const inputStyle = getComputedStyle(input)
      const fieldStyle = getComputedStyle(field)
      return {
        inputBorderWidth: inputStyle.borderTopWidth,
        fieldBorderWidth: fieldStyle.borderTopWidth
      }
    })
    expect(searchChrome.inputBorderWidth).toBe('0px')
    expect(Number.parseFloat(searchChrome.fieldBorderWidth)).toBeGreaterThan(0)

    await search.focus()
    const focusChrome = await search.evaluate((input) => {
      const field = input.closest('label')
      if (!field) throw new Error('Search field shell is missing')
      return {
        inputShadow: getComputedStyle(input).boxShadow,
        fieldShadow: getComputedStyle(field).boxShadow
      }
    })
    expect(focusChrome.inputShadow).toBe('none')
    expect(focusChrome.fieldShadow).not.toBe('none')

    await search.fill('mcp')
    await expect(page.getByTestId('registry-loading-overlay')).toBeVisible()
    await expect(page.getByTestId('registry-package-pi-mcp-adapter')).toBeVisible()
    await expect(page.getByText('Pi Manifest')).toBeVisible()

    await page
      .getByRole('button', { name: /安装|Install/, exact: true })
      .last()
      .click()
    await page
      .getByRole('button', { name: /安装|Install/, exact: true })
      .last()
      .click()
    await expect(page.getByText(/有更新|Update available/).first()).toBeVisible()

    await page
      .getByRole('button', { name: /更新|Update/, exact: true })
      .last()
      .click()
    await page
      .getByRole('button', { name: /更新|Update/, exact: true })
      .last()
      .click()
    await expect(page.getByText(/已安装|Installed/).first()).toBeVisible()

    await search.fill('')
    await expect(page.getByTestId('registry-package-pi-first-page')).toBeVisible()
    await page.getByRole('button', { name: /下一页|Next page/ }).click()
    await expect(page.getByTestId('registry-package-pi-second-page')).toBeVisible()
    await page.getByRole('tab', { name: /技能|Skills/, exact: true }).click()
    await expect(page.getByTestId('featured-capability-odai')).toBeVisible()
    await page.getByRole('tab', { name: /精选|Featured/, exact: true }).click()
    await expect(page.getByTestId('market-collection-core-development')).toBeVisible()
  })

  test('renders the Capabilities surface immediately in Chinese, English, and Japanese', async ({
    electronApp,
    page
  }) => {
    await mockEmptyRegistry(electronApp)
    await page.locator('a[href="#/settings"]').click()
    const languageSelect = page.locator('.ui-select-trigger').first()

    await languageSelect.click()
    await page.getByRole('option', { name: 'English' }).click()
    await expect(page.getByText('Language', { exact: true })).toBeVisible()
    await page.locator('a[href="#/skills"]').click()
    await expect(page.getByRole('heading', { name: 'Capabilities' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Official Market' })).toBeVisible()

    await page.locator('a[href="#/settings"]').click()
    await page.locator('.ui-select-trigger').first().click()
    await page.getByRole('option', { name: '日本語' }).click()
    await expect(page.getByText('言語', { exact: true })).toBeVisible()
    await page.locator('a[href="#/skills"]').click()
    await expect(page.getByRole('heading', { name: '機能センター' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '公式マーケット' })).toBeVisible()

    await page.locator('a[href="#/settings"]').click()
    await page.locator('.ui-select-trigger').first().click()
    await page.getByRole('option', { name: '简体中文' }).click()
    await expect(page.getByText('语言', { exact: true })).toBeVisible()
    await page.locator('a[href="#/skills"]').click()
    await expect(page.getByRole('heading', { name: '能力中心' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '官方市场' })).toBeVisible()
  })
})
