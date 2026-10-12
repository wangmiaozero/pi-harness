import { WebContentsView, ipcMain, type BrowserWindow } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ProjectIntelligenceService } from './service'
import { VIEWER_CSP } from './archify'
import { IPC_EVENT } from '@shared/ipc/channels'
import { setArchitectureFullscreenAllowed } from './fullscreen-permission'
import {
  architectureControlActionSchema,
  architectureViewerControlsSchema
} from '@shared/intelligence/schema'
import { ARCHITECTURE_CONTROLS } from './viewer-controls'

// Reuse Archify's presentation mode, with its controls inside the allocated viewport.
// The exported standalone HTML keeps the upstream page layout.
const EMBEDDED_STYLE = `
html[data-present] body{padding:0!important}
html[data-present] .container{height:100dvh!important;gap:0!important}
html[data-present] .header,html[data-present] .toolbar,html[data-present] .cards{display:none!important}
html[data-present] .diagram-container{border:0!important;border-radius:0!important;padding:.75rem!important;padding-bottom:calc(.75rem + var(--archify-nav-reserve))!important}
html[data-present] .diagram-container>svg{width:100%!important;min-width:0!important;max-width:100%!important;height:100%!important}
`

export const viewerInputSchema = z
  .object({
    url: z
      .string()
      .regex(/^pi-architecture:\/\/viewer\/[a-f0-9-]{36}$/)
      .nullable(),
    bounds: z
      .object({
        x: z.number().int().min(0).max(10000),
        y: z.number().int().min(0).max(10000),
        width: z.number().int().min(0).max(10000),
        height: z.number().int().min(0).max(10000)
      })
      .strict(),
    theme: z.enum(['dark', 'light']),
    selectedId: z
      .string()
      .regex(/^n-[a-f0-9]{16}$/)
      .optional(),
    controls: architectureViewerControlsSchema.optional()
  })
  .strict()

/** Embedded Chromium with OS sandbox, isolated session and no application preload. */
export class ArchitectureViewer {
  private view: WebContentsView | null = null
  private url: string | null = null
  private loading: Promise<void> | null = null
  private owner: BrowserWindow | null = null
  private version = 0
  private visible = false
  constructor(
    private readonly service: ProjectIntelligenceService,
    private readonly resources: string,
    private readonly getWindow: () => BrowserWindow | null
  ) {
    ipcMain.on('architecture:select', (event, id: unknown) => {
      if (
        event.sender !== this.view?.webContents ||
        typeof id !== 'string' ||
        !/^n-[a-f0-9]{16}$/.test(id)
      )
        return
      this.owner?.webContents.send(IPC_EVENT.architectureSelected, { url: this.url, id })
    })
    ipcMain.on('architecture:control', (event, input: unknown) => {
      const result = architectureControlActionSchema.safeParse(input)
      const owner = this.owner
      if (
        event.sender !== this.view?.webContents ||
        !this.visible ||
        !result.success ||
        !owner ||
        owner.isDestroyed()
      )
        return
      const action = result.data
      if (action === 'fullscreen') {
        void owner.webContents
          .executeJavaScript(
            "(()=>{const panel=document.getElementById('pi-architecture-panel');if(!panel)return;if(document.fullscreenElement===panel)return document.exitFullscreen();return panel.requestFullscreen()})()",
            true
          )
          .catch(() => {
            if (!owner.isDestroyed())
              owner.webContents.send(IPC_EVENT.architectureControl, {
                url: this.url,
                action: 'fullscreen-error'
              })
          })
      } else owner.webContents.send(IPC_EVENT.architectureControl, { url: this.url, action })
    })
  }
  async show(input: unknown): Promise<void> {
    const version = ++this.version
    const request = viewerInputSchema.parse(input)
    const owner = this.getWindow()
    if (!owner || owner.isDestroyed()) return
    if (!request.url) {
      this.visible = false
      if (this.owner) setArchitectureFullscreenAllowed(this.owner.webContents, false)
      this.view?.setVisible(false)
      return
    }
    if (!(await this.service.viewer(request.url)))
      throw new Error('Architecture viewer authorization expired.')
    if (version !== this.version) return
    if (!this.view || this.owner !== owner || this.view.webContents.isDestroyed()) {
      this.close(false)
      const view = new WebContentsView({
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          partition: `architecture-${randomUUID()}`,
          preload: path.join(this.resources, 'viewer-preload.cjs')
        }
      })
      this.view = view
      this.owner = owner
      owner.contentView.addChildView(view)
      // The diagram owns keyboard focus; Escape must exit its parent's fullscreen.
      view.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.key !== 'Escape' || owner.isDestroyed()) return
        void owner.webContents
          .executeJavaScript(
            "if(document.fullscreenElement?.id==='pi-architecture-panel')document.exitFullscreen()"
          )
          .catch(() => undefined)
      })
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      view.webContents.on('will-navigate', (event, url) => {
        if (url !== this.url) event.preventDefault()
      })
      view.webContents.session.setPermissionCheckHandler(() => false)
      view.webContents.session.on('will-download', (event) => event.preventDefault())
      view.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false)
      )
      view.webContents.session.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: details.url !== this.url && !/^(?:data|blob):/.test(details.url) })
      )
      view.webContents.session.protocol.handle('pi-architecture', async (request) => {
        const html = await this.service.viewer(request.url)
        return new Response(html ?? 'Unavailable', {
          status: html ? 200 : 404,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': VIEWER_CSP
          }
        })
      })
      owner.once('closed', () => this.close())
    }
    const view = this.view
    const [width, height] = owner.getContentSize()
    const b = request.bounds
    view.setBounds({
      x: Math.min(b.x, width),
      y: Math.min(b.y, height),
      width: Math.max(0, Math.min(b.width, width - b.x)),
      height: Math.max(0, Math.min(b.height, height - b.y))
    })
    view.setVisible(b.width > 0 && b.height > 0)
    this.visible = b.width > 0 && b.height > 0
    setArchitectureFullscreenAllowed(owner.webContents, b.width > 0 && b.height > 0)
    if (this.url !== request.url) {
      this.url = request.url
      this.loading = view.webContents.loadURL(request.url)
    }
    try {
      await this.loading
    } catch (error) {
      if (version !== this.version || view !== this.view) return
      throw error
    }
    if (version !== this.version || view !== this.view || view.webContents.isDestroyed()) return
    await view.webContents.executeJavaScript(
      `document.documentElement.dataset.theme=${JSON.stringify(request.theme)};
      document.documentElement.dataset.present='true';
      if(!document.getElementById('pi-embedded-view')){
        const style=document.createElement('style');style.id='pi-embedded-view';
        style.textContent=${JSON.stringify(EMBEDDED_STYLE)};document.head.append(style)
      }
      document.querySelector('.export-wrap')?.setAttribute('hidden','');
      ${request.controls ? `${ARCHITECTURE_CONTROLS};window.piArchitectureControls?.update(${JSON.stringify(request.controls)});` : ''}
      ${request.selectedId ? `document.querySelector('[data-node-id="${request.selectedId}"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));` : ''}`
    )
  }
  close(invalidate = true): void {
    this.visible = false
    if (this.owner) setArchitectureFullscreenAllowed(this.owner.webContents, false)
    if (invalidate) this.version++
    if (this.view) {
      try {
        this.owner?.contentView.removeChildView(this.view)
      } catch {
        /* owner closed */
      }
      if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
      this.view = null
    }
    this.owner = null
    this.url = null
    this.loading = null
  }
  async capture(url: string): Promise<Buffer> {
    const version = this.version
    if (this.url !== url || !this.view || this.view.webContents.isDestroyed())
      throw new Error('Open this architecture map before exporting its view.')
    const image = await this.view.webContents.capturePage()
    if (version !== this.version)
      throw new Error('The architecture view changed during export. Retry.')
    return image.toPNG()
  }
}
