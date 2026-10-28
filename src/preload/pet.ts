/**
 * Desktop pet window preload — a deliberately narrow, non-privileged bridge.
 *
 * The pet renderer never sees the full `piSwitch` API. Every invoke channel
 * it can reach is pet-scoped and validated in the main process against the
 * pet window's webContents (see src/main/pet/service.ts), mirroring the
 * listen-only overlay preload discipline.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc/channels'
import { PET_API_NAMESPACE } from '../shared/constants/index'
import type {
  PiSwitchPetAPI,
  PetStatePushPayload,
  PetWindowContextPayload,
  PetMovePayload,
  PetDragEndPayload,
  PetMenuAction,
  PiSwitchMoveResult
} from '../shared/ipc/api-types'

const api: PiSwitchPetAPI = {
  getContext: () => ipcRenderer.invoke(IPC_INVOKE.petGetContext),
  onState(listener) {
    const handler = (_event: IpcRendererEvent, payload: PetStatePushPayload) => listener(payload)
    ipcRenderer.on(IPC_EVENT.petState, handler)
    return () => ipcRenderer.removeListener(IPC_EVENT.petState, handler)
  },
  onConfig(listener) {
    const handler = (_event: IpcRendererEvent, payload: PetWindowContextPayload) => listener(payload)
    ipcRenderer.on(IPC_EVENT.petConfig, handler)
    return () => ipcRenderer.removeListener(IPC_EVENT.petConfig, handler)
  },
  moveBy: (payload: PetMovePayload) => ipcRenderer.invoke(IPC_INVOKE.petMoveBy, payload) as Promise<PiSwitchMoveResult>,
  endDrag: (payload: PetDragEndPayload) => ipcRenderer.invoke(IPC_INVOKE.petEndDrag, payload),
  setClickThrough: (through: boolean) => ipcRenderer.invoke(IPC_INVOKE.petSetClickThrough, through),
  openMain: (view?: 'main' | 'settings') => ipcRenderer.invoke(IPC_INVOKE.petOpenMain, view),
  menuAction: (action: PetMenuAction) => ipcRenderer.invoke(IPC_INVOKE.petMenuAction, action)
}

contextBridge.exposeInMainWorld(PET_API_NAMESPACE, api)
