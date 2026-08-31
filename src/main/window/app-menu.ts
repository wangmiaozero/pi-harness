/**
 * Application menu.
 *
 * Electron installs a default application menu when the app never sets one.
 * That default menu binds File > Close Window to the CmdOrCtrl+W native menu
 * accelerator. Native accelerators are dispatched before any web-contents
 * keydown, so the in-app workspace shortcut "close tab" (registered as
 * CmdOrCtrl+W / Ctrl+W in the renderer) could never fire: pressing it during a
 * workspace conversation destroyed the whole window while the agent task kept
 * running in the main process, forcing the user to reopen the window from the
 * dock/taskbar.
 *
 * The menu below deliberately registers no close-window accelerator on any
 * platform. Closing the app stays available through the macOS traffic lights
 * and the custom title bar button. Standard text-editing and view roles are
 * preserved because macOS web content depends on the Edit menu roles for
 * Cmd+C/V/X/Z key equivalents.
 */

import { Menu, app } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { AppSettings } from '@shared/ipc/api-types'

/** Flat list of every item in the template, depth-first, parents included. */
export function collectMenuItems(
  template: MenuItemConstructorOptions[]
): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = []
  const walk = (items: MenuItemConstructorOptions[]): void => {
    for (const item of items) {
      out.push(item)
      if (Array.isArray(item.submenu)) walk(item.submenu as MenuItemConstructorOptions[])
    }
  }
  walk(template)
  return out
}

/** True when any item would close a window or binds the Cmd/Ctrl+W chord. */
export function hasCloseWindowAccelerator(template: MenuItemConstructorOptions[]): boolean {
  const isCloseChord = (accelerator: string): boolean => {
    const parts = accelerator.split('+').map((part) => part.trim().toLowerCase())
    const modifier = parts.slice(0, -1)
    return (
      parts.at(-1) === 'w' &&
      modifier.some((part) => ['cmd', 'ctrl', 'command', 'control', 'cmdorctrl', 'commandorcontrol'].includes(part))
    )
  }
  return collectMenuItems(template).some(
    (item) => item.role === 'close' || (item.accelerator ? isCloseChord(item.accelerator) : false)
  )
}

/** Pure template builder - unit-testable without a running Electron app. */
export function buildAppMenuTemplate(
  isMac: boolean,
  language: AppSettings['language'],
  appLocale: string
): MenuItemConstructorOptions[] {
  const zh =
    language === 'zh-CN' || (language === 'auto' && !appLocale.toLowerCase().startsWith('en'))
  const macAppMenu: MenuItemConstructorOptions[] = isMac ? [{ role: 'appMenu' }] : []
  const macWindowExtras: MenuItemConstructorOptions[] = isMac
    ? [{ type: 'separator' }, { role: 'front' }]
    : []
  return [
    ...macAppMenu,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: zh ? '窗口' : 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...macWindowExtras]
    }
  ]
}

/** Replace Electron's default menu. Call after app.whenReady(). */
export function installAppMenu(language: AppSettings['language']): void {
  const template = buildAppMenuTemplate(
    process.platform === 'darwin',
    language,
    app.getLocale()
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
