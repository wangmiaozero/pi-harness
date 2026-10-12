// Pi-Harness bridge. No invoke, filesystem, or Node API is exposed.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('architectureSelection', {
  select(id) {
    if (typeof id === 'string' && /^n-[a-f0-9]{16}$/.test(id)) ipcRenderer.send('architecture:select', id)
  }
})
