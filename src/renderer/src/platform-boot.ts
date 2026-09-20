/**
 * Platform boot entry — loaded as a module script BEFORE `main.ts`
 * (see `src/renderer/index.html`).
 *
 * Module scripts execute in document order, and this file's top-level await
 * delays `main.ts` until `window.piSwitch` is installed — the same
 * guarantee the Electron preload gives.
 */

import { bootDesktopPlatform } from '@platform/boot'

await bootDesktopPlatform()
