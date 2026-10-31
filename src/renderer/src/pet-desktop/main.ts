/**
 * Desktop pet window entry — frame playback, status bubble, drag/physics,
 * alpha-based click-through and the context menu. Deliberately framework
 * free: the pet window is a small, always-available surface.
 *
 * Security posture: the only privileged surface is the narrow `piSwitchPet`
 * bridge (see src/preload/pet.ts); frame images load exclusively from the
 * validated `pi-pet://` protocol.
 */

import { resolveAppLocale, type AppLanguage } from '@shared/constants/language'
import type { DesktopPetSettings } from '@shared/pet/desktop'
import { resolveStateClip, type PetPackManifest } from '@shared/pet/desktop'
import type { PetWindowContextPayload } from '@shared/ipc/api-types'
import { bubbleMessages, type BubbleMessages } from './bubbles'
import { FramePlayer } from './frame-player'
import { PetStateReducer, type PetRuntimeState } from './state'
import { ReleasePhysics } from './physics'
import { showPetMenu, dismissPetMenu } from './menu'

const BUBBLE_SHOW_MS = 3600
const CLICK_THROUGH_SAMPLE_MS = 80
const TAP_MAX_MOVE_PX = 6
const DOUBLE_TAP_MS = 380
const ALPHA_THRESHOLD = 8

const BUBBLE_KEY_FOR_STATE: Record<PetRuntimeState, keyof BubbleMessages | null> = {
  idle: 'idle',
  thinking: 'thinking',
  running: 'running',
  'tool-calling': 'toolCalling',
  waiting: 'waiting',
  success: 'success',
  failed: 'failed',
  warning: 'warning',
  sleeping: 'sleeping'
}

interface InteractionClip {
  clip: string
  loop: boolean
}

class PetApp {
  private manifest: PetPackManifest | null = null
  private settings: DesktopPetSettings | null = null
  private language: AppLanguage = 'en-US'
  private player: FramePlayer | null = null
  private readonly reducer = new PetStateReducer()
  private physics: ReleasePhysics | null = null
  private fish: HTMLDivElement | null = null
  private bubble: HTMLDivElement | null = null
  private bubbleTimer: number | null = null
  private currentState: PetRuntimeState = 'idle'
  private interaction: InteractionClip | null = null
  private taskActive = false
  private dragging = false
  private pointerDownAt = 0
  private pointerDownPos = { x: 0, y: 0 }
  private lastTapAt = 0
  private lastActiveAgents = 0
  private lastClickThroughThrough = false
  private clickThroughAt = 0
  private alphaSamplingFailed = false

  async boot(): Promise<void> {
    const api = window.piSwitchPet
    if (!api) {
      console.error('[pet] bridge unavailable — pet window disabled')
      return
    }
    let context: PetWindowContextPayload
    try {
      context = await api.getContext()
    } catch (error) {
      console.error('[pet] context unavailable', error)
      return
    }
    this.applyContext(context)
    this.buildDom()
    this.renderState(this.currentState, true)

    api.onState((payload) => {
      this.updateTaskActivity(payload.activeAgents)
      if (!this.settings?.agentSync) {
        if (this.currentState !== 'idle') this.renderState('idle', true)
        return
      }
      this.lastActiveAgents = payload.activeAgents
      this.handleEatToken(payload.events)
      const snapshot = this.reducer.apply(payload.events, payload.activeAgents)
      if (snapshot) this.renderState(snapshot.state)
    })
    api.onConfig((context) => this.applyContext(context))

    window.setInterval(() => {
      const snapshot = this.reducer.tick()
      if (snapshot) this.renderState(snapshot.state)
    }, 1000)

    window.addEventListener('mousemove', (event) => this.onGlobalMove(event))
    this.bindPointer(api)
    window.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.openMenu()
    })
    window.addEventListener('blur', () => {
      this.lastClickThroughThrough = false
      void api.setClickThrough(false)
    })
  }

  private openMenu(): void {
    if (!this.settings) return
    this.physics?.cancel()
    this.lastClickThroughThrough = false
    void window.piSwitchPet?.setClickThrough(false)
    showPetMenu({
      busy: this.taskActive,
      language: this.language,
      alwaysOnTop: this.settings.alwaysOnTop,
      reducedMotion: this.settings.reducedMotion,
      actions: this.manifest
        ? Object.entries(this.manifest.clips)
            .filter(([, info]) => info.labels)
            .map(([clip, info]) => ({
              clip,
              label:
                info.labels?.[resolveAppLocale(this.language, navigator.language)] ??
                info.labels?.['en-US'] ??
                clip
            }))
        : [],
      onPlayAction: (clip) => {
        if (!this.taskActive && this.player?.has(clip)) this.playInteraction({ clip, loop: false })
      },
      onAction: (action) => void window.piSwitchPet?.menuAction(action)
    })
  }

  private updateTaskActivity(activeAgents: number): void {
    const wasActive = this.taskActive
    this.taskActive = activeAgents > 0
    if (this.taskActive) {
      if (!wasActive) dismissPetMenu()
      this.physics?.cancel()
      if (!wasActive && this.interaction) {
        this.interaction = null
        this.playStateClip(this.currentState)
      }
    }
  }

  private applyContext(context: PetWindowContextPayload): void {
    const previousLanguage = this.language
    const previousPackId = this.manifest?.id ?? null
    this.physics?.cancel()
    this.manifest = context.manifest
    this.settings = context.settings
    this.updateTaskActivity(context.activeAgents)
    this.language = context.language
    document.documentElement.lang = context.language
    if (previousLanguage !== this.language) {
      if (this.bubble?.style.display === 'block') this.showBubbleFor(this.currentState)
      if (document.getElementById('pet-context-menu')) this.openMenu()
    }
    if (!this.player && context.manifest) {
      this.player = new FramePlayer(context.manifest.id, context.manifest)
      this.physics = new ReleasePhysics(
        async (dx, dy) => {
          const result = await window.piSwitchPet?.moveBy({ dx, dy })
          return result ? { x: result.x, y: result.y } : null
        },
        () => {
          void window.piSwitchPet?.endDrag({ vx: 0, vy: 0 }).catch(() => {})
        }
      )
    } else if (this.player && context.manifest && previousPackId !== context.manifest.id) {
      // Live pack switch: tear down cached frames of the old pack and build
      // a fresh player for the new one.
      this.player.dispose()
      this.player = new FramePlayer(context.manifest.id, context.manifest)
      if (this.fish) this.fish.replaceChildren(this.player.element)
      this.interaction = null
      this.renderState(this.currentState, true)
    }
    if (this.fish) {
      this.fish.style.height = `${this.settings.size}px`
      if (this.player) {
        this.player.element.style.cssText = `display:block;height:100%;width:auto;max-width:100%;object-fit:contain`
      }
    }
    if (this.bubble) {
      this.bubble.style.opacity = String(this.settings?.bubbleOpacity ?? 1)
    }
  }

  private buildDom(): void {
    const root = document.getElementById('app')
    if (!root) return
    document.body.style.cssText =
      'margin:0;background:transparent;overflow:hidden;user-select:none;-webkit-user-select:none'
    root.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column'

    this.bubble = document.createElement('div')
    this.bubble.style.cssText = [
      'align-self:center',
      'margin-top:6px',
      'max-width:92%',
      'padding:6px 12px',
      'border-radius:14px',
      'background:rgba(28,28,30,0.88)',
      'color:#f5f5f7',
      'font:13px/1.4 -apple-system,"Segoe UI","PingFang SC",sans-serif',
      'text-align:center',
      'display:none',
      'transition:opacity 0.25s',
      'pointer-events:none',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis'
    ].join(';')

    this.fish = document.createElement('div')
    this.fish.style.cssText = `position:absolute;bottom:0;left:0;right:0;height:${this.settings?.size ?? 160}px;display:flex;align-items:flex-end;justify-content:center;cursor:grab;touch-action:none`
    if (this.player) {
      this.player.element.style.cssText =
        'display:block;height:100%;width:auto;max-width:100%;object-fit:contain'
      this.fish.replaceChildren(this.player.element)
    }

    root.appendChild(this.bubble)
    root.appendChild(this.fish)
  }

  /** Resolve the clip for a runtime state via the pack's mapping rules. */
  private clipFor(state: PetRuntimeState): string {
    const manifest = this.manifest
    if (!manifest) return 'idle'
    const clip = resolveStateClip(manifest, state)
    return this.player?.has(clip) ? clip : 'idle'
  }

  private renderState(state: PetRuntimeState, force = false): void {
    if (!force && state === this.currentState) {
      this.showBubbleFor(state)
      return
    }
    this.currentState = state
    this.showBubbleFor(state)
    if ((!this.dragging || this.taskActive) && !this.interaction) this.playStateClip(state)
  }

  private playStateClip(state: PetRuntimeState): void {
    const player = this.player
    if (!player) return
    const primary = this.clipFor(state)
    if (state === 'idle' && this.settings?.idleVariants && !this.settings?.reducedMotion) {
      // Occasionally splice in an idle variant between loops.
      if (Math.random() < 0.12) {
        const variant = player.has('idle_stretch')
          ? 'idle_stretch'
          : player.has('idle_yawn')
            ? 'idle_yawn'
            : null
        if (variant) {
          this.playInteraction({ clip: variant, loop: false })
          return
        }
      }
    }
    player.play(primary)
  }

  private playInteraction(clip: InteractionClip): void {
    const player = this.player
    if (!player) return
    this.interaction = clip
    player.play(
      clip.clip,
      () => {
        this.interaction = null
        if (!this.dragging) this.playStateClip(this.currentState)
      },
      clip.loop
    )
  }

  private showBubbleFor(state: PetRuntimeState): void {
    const bubble = this.bubble
    const settings = this.settings
    if (!bubble || !settings) return
    const key = BUBBLE_KEY_FOR_STATE[state]
    if (!settings.bubbleEnabled || key === null) {
      bubble.style.display = 'none'
      return
    }
    let text = bubbleMessages(this.language)[key]
    if (state === 'running' && settings.showAgentCount && this.lastActiveAgents > 1) {
      text = `${text} (${this.lastActiveAgents})`
    }
    bubble.textContent = text
    bubble.style.display = 'block'
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer)
    if (settings.bubbleTimeoutSeconds > 0) {
      this.bubbleTimer = window.setTimeout(() => {
        bubble.style.display = 'none'
      }, settings.bubbleTimeoutSeconds * 1000)
    }
  }

  private handleEatToken(events: ReadonlyArray<{ type: string }>): void {
    if (this.settings?.reducedMotion) return
    if (!events.some((event) => event.type === 'STREAM_STARTED')) return
    const player = this.player
    if (player && player.has('eat_token') && this.reducer.canEatToken(Date.now())) {
      this.playInteraction({ clip: 'eat_token', loop: false })
    }
  }

  private bindPointer(api: NonNullable<typeof window.piSwitchPet>): void {
    const fish = this.fish
    if (!fish) return
    let lastMoveAt = 0
    let lastMovePos = { x: 0, y: 0 }
    let releaseVelocity = { x: 0, y: 0 }
    let dragGeneration = 0

    fish.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      dismissPetMenu()
      dragGeneration += 1
      this.dragging = false
      this.pointerDownAt = performance.now()
      this.pointerDownPos = { x: event.screenX, y: event.screenY }
      releaseVelocity = { x: 0, y: 0 }
      lastMoveAt = this.pointerDownAt
      lastMovePos = { ...this.pointerDownPos }
      this.physics?.cancel()
      fish.setPointerCapture(event.pointerId)
    })

    fish.addEventListener('pointermove', (event) => {
      if (this.pointerDownAt === 0) return
      const dx = event.screenX - this.pointerDownPos.x
      const dy = event.screenY - this.pointerDownPos.y
      const moved = Math.hypot(dx, dy)
      if (!this.dragging && moved > TAP_MAX_MOVE_PX) {
        this.dragging = true
        fish.style.cursor = 'grabbing'
        if (!this.taskActive && this.player?.has('dragging'))
          this.playInteraction({ clip: 'dragging', loop: true })
      }
      if (!this.dragging) return
      const now = performance.now()
      const stepX = event.screenX - lastMovePos.x
      const stepY = event.screenY - lastMovePos.y
      const dt = Math.max(16, now - lastMoveAt)
      releaseVelocity = { x: (stepX / dt) * 1000, y: (stepY / dt) * 1000 }
      lastMoveAt = now
      lastMovePos = { x: event.screenX, y: event.screenY }
      void api.moveBy({ dx: Math.round(stepX), dy: Math.round(stepY) })
    })

    fish.addEventListener('pointerup', (event) => {
      if (event.button !== 0 || this.pointerDownAt === 0) return
      fish.style.cursor = 'grab'
      const wasDragging = this.dragging
      this.dragging = false
      this.pointerDownAt = 0
      if (wasDragging) {
        const v = performance.now() - lastMoveAt <= 80 ? releaseVelocity : { x: 0, y: 0 }
        const generation = dragGeneration
        this.interaction = null
        if (this.taskActive) {
          // Keep runtime playback unchanged while moving a working pet.
        } else if (this.player?.has('dragging_release')) {
          this.playInteraction({ clip: 'dragging_release', loop: false })
        } else {
          this.playStateClip(this.currentState)
        }
        // Persist every drag, including when motion effects are disabled.
        void api
          .endDrag({ vx: Math.round(v.x), vy: Math.round(v.y) })
          .then(() => {
            if (generation !== dragGeneration || this.pointerDownAt !== 0) return
            if (!this.taskActive && this.settings?.physics && !this.settings.reducedMotion)
              this.physics?.launch(v)
          })
          .catch(() => {
            /* Keep the released position if the bridge is unavailable. */
          })
        return
      }
      if (!this.taskActive) this.handleTap()
    })

    fish.addEventListener('pointercancel', () => {
      dragGeneration += 1
      this.physics?.cancel()
      void api.endDrag({ vx: 0, vy: 0 })
      this.interaction = null
      this.dragging = false
      this.pointerDownAt = 0
      fish.style.cursor = 'grab'
      this.playStateClip(this.currentState)
    })
  }

  private handleTap(): void {
    const now = performance.now()
    const doubleTap = now - this.lastTapAt < DOUBLE_TAP_MS
    this.lastTapAt = now
    const player = this.player
    if (!player) return
    if (doubleTap && player.has('head_pat')) {
      this.playInteraction({ clip: 'head_pat', loop: false })
      this.showBubbleKey('headPat')
      return
    }
    if (player.has('poke')) {
      this.playInteraction({ clip: 'poke', loop: false })
      this.showBubbleKey('poke')
    }
  }

  private showBubbleKey(key: keyof BubbleMessages): void {
    const bubble = this.bubble
    if (!bubble || !this.settings?.bubbleEnabled) return
    bubble.textContent = bubbleMessages(this.language)[key]
    bubble.style.display = 'block'
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer)
    this.bubbleTimer = window.setTimeout(() => {
      bubble.style.display = 'none'
    }, BUBBLE_SHOW_MS)
  }

  /** Alpha-sample under the cursor so empty pixels never swallow clicks. */
  private onGlobalMove(event: MouseEvent): void {
    // The menu is interactive even where the pet image underneath is transparent.
    if (document.getElementById('pet-context-menu')) return
    const player = this.player
    if (!player || this.dragging || this.pointerDownAt !== 0) return
    const now = performance.now()
    if (now - this.clickThroughAt < CLICK_THROUGH_SAMPLE_MS) return
    this.clickThroughAt = now
    const rect = player.element.getBoundingClientRect()
    let alpha: number
    try {
      alpha = player.alphaAt(event.clientX - rect.left, event.clientY - rect.top)
    } catch (error) {
      // Fail safe: without pixel data we cannot know if the point is
      // transparent, so keep the window interactive (the fish stays
      // draggable) instead of blocking clicks on a wrong guess.
      if (!this.alphaSamplingFailed) {
        this.alphaSamplingFailed = true
        console.error('[pet] alpha sampling failed; click-through disabled', error)
      }
      return
    }
    const through = alpha < ALPHA_THRESHOLD
    if (through !== this.lastClickThroughThrough) {
      this.lastClickThroughThrough = through
      void window.piSwitchPet?.setClickThrough(through)
    }
  }
}

void new PetApp().boot()
