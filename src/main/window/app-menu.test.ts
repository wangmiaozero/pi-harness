import { describe, expect, it, vi } from 'vitest'
import { Menu, app } from 'electron'
import {
  buildAppMenuTemplate,
  collectMenuItems,
  hasCloseWindowAccelerator,
  installAppMenu
} from './app-menu'
import type { MenuItemConstructorOptions } from 'electron'

vi.mock('electron', () => ({
  Menu: {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({ __template: template }))
  },
  app: {
    getLocale: vi.fn(() => 'en-US')
  }
}))

describe('app menu', () => {
  it('never registers a close-window accelerator on any platform', () => {
    for (const isMac of [true, false]) {
      for (const language of ['auto', 'zh-CN', 'en-US'] as const) {
        const template = buildAppMenuTemplate(isMac, language, 'en-US')
        expect(hasCloseWindowAccelerator(template)).toBe(false)
      }
    }
  })

  it('keeps the edit and view roles (macOS text editing + zoom/fullscreen)', () => {
    for (const isMac of [true, false]) {
      const template = buildAppMenuTemplate(isMac, 'en-US', 'en-US')
      const roles = collectMenuItems(template).map((item) => item.role)
      expect(roles).toContain('editMenu')
      expect(roles).toContain('viewMenu')
    }
  })

  it('keeps quit, minimize and zoom while dropping close (mac)', () => {
    const template = buildAppMenuTemplate(true, 'en-US', 'en-US')
    const roles = collectMenuItems(template).map((item) => item.role)
    expect(roles).toContain('appMenu') // About/Services/Hide/Quit (Cmd+Q)
    expect(roles).toContain('minimize')
    expect(roles).toContain('zoom')
    expect(roles).toContain('front')
    expect(roles).not.toContain('close')
  })

  it('omits the appMenu role on windows/linux', () => {
    const roles = collectMenuItems(buildAppMenuTemplate(false, 'en-US', 'en-US')).map(
      (item) => item.role
    )
    expect(roles).not.toContain('appMenu')
    expect(roles).toContain('minimize')
    expect(roles).not.toContain('close')
  })

  it('localizes the window menu label from the app language', () => {
    expect(buildAppMenuTemplate(true, 'zh-CN', 'en-US')[3].label).toBe('窗口')
    expect(buildAppMenuTemplate(false, 'en-US', 'zh-CN')[2].label).toBe('Window')
  })

  it('resolves auto language against the system locale', () => {
    expect(buildAppMenuTemplate(true, 'auto', 'zh-CN')[3].label).toBe('窗口')
    expect(buildAppMenuTemplate(true, 'auto', 'en-US')[3].label).toBe('Window')
  })

  it('detects the regression: a close role or Cmd/Ctrl+W accelerator', () => {
    expect(hasCloseWindowAccelerator([{ role: 'close' }])).toBe(true)
    expect(
      hasCloseWindowAccelerator([{ label: 'Close Window', accelerator: 'CmdOrCtrl+W' }])
    ).toBe(true)
    expect(
      hasCloseWindowAccelerator([{ label: 'File', submenu: [{ role: 'close' }] }])
    ).toBe(true)
    expect(hasCloseWindowAccelerator([{ role: 'quit' }])).toBe(false)
  })

  it('installs the built template as the application menu', () => {
    vi.mocked(app.getLocale).mockReturnValue('en-US')
    vi.mocked(Menu.buildFromTemplate).mockClear()
    vi.mocked(Menu.setApplicationMenu).mockClear()

    installAppMenu('zh-CN')

    expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1)
    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1)
    const installed = vi.mocked(Menu.setApplicationMenu).mock.calls[0][0] as {
      __template?: MenuItemConstructorOptions[]
    }
    expect(installed.__template).toBeDefined()
    expect(hasCloseWindowAccelerator(installed.__template ?? [])).toBe(false)
    const templateArg = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0] as MenuItemConstructorOptions[]
    expect(templateArg).toBeDefined()
    expect(hasCloseWindowAccelerator(templateArg)).toBe(false)
  })
})
