/**
 * Overlay preload — listen-only. The screen-motion window must never invoke
 * privileged IPC or see the full `piSwitch` bridge.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_EVENT } from '../shared/ipc/channels'
import { OVERLAY_API_NAMESPACE } from '../shared/constants/index'
import type { PiSwitchOverlayAPI, ScreenMotionActivePayload } from '../shared/ipc/api-types'

const api: PiSwitchOverlayAPI = {
  onActive(listener) {
    const handler = (_event: IpcRendererEvent, payload: ScreenMotionActivePayload) => {
      listener(payload)
    }
    ipcRenderer.on(IPC_EVENT.aiMotionActive, handler)
    return () => ipcRenderer.removeListener(IPC_EVENT.aiMotionActive, handler)
  }
}

contextBridge.exposeInMainWorld(OVERLAY_API_NAMESPACE, api)
