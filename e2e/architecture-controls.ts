import { expect, type ElectronApplication } from '@playwright/test'

/** Click the embedded Chromium control with native input, not the host Vue document. */
export async function clickArchitectureControl(
  app: ElectronApplication,
  action: 'previous' | 'next' | 'overview' | 'fullscreen'
): Promise<void> {
  await expect
    .poll(() =>
      app.evaluate(async ({ webContents, BrowserWindow }, action) => {
        const view = webContents
          .getAllWebContents()
          .find((view) => view.getURL().startsWith('pi-architecture:'))
        if (!view) return { matches: false, reason: 'missing viewer' }
        const owner = BrowserWindow.getAllWindows().find((window) =>
          window.contentView.children.some(
            (child) => (child as { webContents?: { id: number } }).webContents?.id === view.id
          )
        )
        if (!owner) return { matches: false, reason: 'missing owner' }
        const host = await owner.webContents.executeJavaScript(`(()=>{
          const box=document.querySelector('[data-testid=architecture-viewer]')?.getBoundingClientRect();
          return box&&{width:Math.round(box.width),height:Math.round(box.height),fullscreen:document.fullscreenElement?.id==='pi-architecture-panel'};
        })()`)
        if (
          !host ||
          (host.fullscreen &&
            !(
              owner.isFullScreen() ||
              (process.platform === 'darwin' && owner.isSimpleFullScreen())
            ))
        )
          return { matches: false, reason: 'owner transition', host }
        const frame = await view.executeJavaScript(`(()=>{
          const button=document.querySelector('[data-testid="architecture-${action}"]');
          return {ready:Boolean(button&&!button.disabled&&!button.hidden&&button.getBoundingClientRect().width),width:innerWidth,height:innerHeight,fullscreen:document.querySelector('[data-testid=architecture-fullscreen]')?.getAttribute('aria-pressed')==='true'};
        })()`)
        return {
          host,
          frame,
          matches:
            frame.ready &&
            Math.abs(frame.width - host.width) <= 1 &&
            Math.abs(frame.height - host.height) <= 1 &&
            frame.fullscreen === host.fullscreen
        }
      }, action)
    )
    .toMatchObject({ matches: true })
  await app.evaluate(async ({ webContents }, action) => {
    const view = webContents
      .getAllWebContents()
      .find((view) => view.getURL().startsWith('pi-architecture:'))!
    const point = await view.executeJavaScript(`(()=>{
      const button=document.querySelector('[data-testid="architecture-${action}"]');
      if(!button || button.disabled || button.hidden)throw new Error('Architecture control unavailable');
      const box=button.getBoundingClientRect();return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
    })()`)
    view.focus()
    view.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    view.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }, action)
}

/** Check painted text/icons as well as button boxes; intrinsic SVG sizing can leak past a box. */
export async function expectArchitectureDockToFit(app: ElectronApplication): Promise<void> {
  const violations = await app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((view) => view.getURL().startsWith('pi-architecture:'))!
    return view.executeJavaScript(`(()=>{
      const dock=document.querySelector('.diagram-nav');
      const failures=[];
      const buttons=[...dock.querySelectorAll('button')].filter(button=>button.getClientRects().length);
      for(const [index,button] of buttons.entries()){
        const box=button.getBoundingClientRect();
        const name=button.getAttribute('aria-label')||button.textContent;
        const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);
        let node;
        while(node=walker.nextNode()){
          if(!node.textContent.trim())continue;
          const range=document.createRange();range.selectNodeContents(node);
          for(const rect of range.getClientRects()){
            if(rect.width>0&&(rect.left<box.left-1||rect.right>box.right+1||rect.top<box.top-1||rect.bottom>box.bottom+1))failures.push(name+': text outside button');
          }
        }
        const icon=button.querySelector('svg');
        if(icon){
          const rect=icon.getBoundingClientRect();
          if(rect.width>16.1||rect.height>16.1||rect.left<box.left-1||rect.right>box.right+1)failures.push(name+': icon outside button');
        }
        if(box.left<0||box.top<0||box.right>innerWidth+1||box.bottom>innerHeight+1)failures.push(name+': outside viewport');
        for(const other of buttons.slice(index+1)){
          const rect=other.getBoundingClientRect();
          if(Math.min(box.right,rect.right)>Math.max(box.left,rect.left)+1.1&&Math.min(box.bottom,rect.bottom)>Math.max(box.top,rect.top)+1.1)failures.push(name+': overlapping buttons');
        }
      }
      return failures;
    })()`)
  })
  expect(violations).toEqual([])
}
