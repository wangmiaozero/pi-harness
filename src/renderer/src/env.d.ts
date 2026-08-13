/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

import type { PiSwitchAPI } from '@shared/ipc/api-types'

declare global {
  interface Window {
    /** Typed IPC bridge exposed by Electron preload. Required for the desktop app. */
    piSwitch?: PiSwitchAPI
  }
}

export {}
