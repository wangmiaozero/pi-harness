/**
 * Release physics for the desktop pet — a short gravity-and-bounce flight
 * after the user lets go, expressed as window translations. Stops early on
 * any pointer re-grab so the animation can never fight the user.
 */

export interface Vec2 {
  x: number
  y: number
}

export interface PhysicsBounds {
  /** Work area in screen coordinates (CSS px), from PiSwitchMoveResult. */
  x: number
  y: number
  width: number
  height: number
}

const GRAVITY_PX_S2 = 3200
const BOUNCE_DAMPING = 0.45
const AIR_DAMPING = 0.995
const SETTLE_SPEED_PX_S = 40
const FRAME_MS = 16
/** Keep at least a sliver of the pet inside the visible work area. */
const MARGIN_PX = 24

export class ReleasePhysics {
  private timer: number | null = null

  constructor(
    private readonly moveBy: (dx: number, dy: number) => Promise<{ x: number; y: number } | null>
  ) {}

  get active(): boolean {
    return this.timer !== null
  }

  cancel(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Launch the pet with a release velocity. bounds describe the work area. */
  launch(velocity: Vec2, bounds: PhysicsBounds | null): void {
    this.cancel()
    let vx = velocity.x
    let vy = velocity.y
    if (!bounds) {
      if (Math.hypot(vx, vy) < SETTLE_SPEED_PX_S) return
      // No work-area info: glide with damping only, no walls.
      this.timer = window.setInterval(() => {
        vx *= AIR_DAMPING
        vy *= AIR_DAMPING
        void this.moveBy(Math.round(vx * (FRAME_MS / 1000)), Math.round(vy * (FRAME_MS / 1000)))
        if (Math.hypot(vx, vy) < SETTLE_SPEED_PX_S) this.cancel()
      }, FRAME_MS)
      return
    }
    this.timer = window.setInterval(() => {
      const dt = FRAME_MS / 1000
      vy += GRAVITY_PX_S2 * dt
      vx *= AIR_DAMPING
      const dx = Math.round(vx * dt)
      const dy = Math.round(vy * dt)
      void this.moveBy(dx, dy).then((position) => {
        if (!position) {
          this.cancel()
          return
        }
        const floor = bounds.y + bounds.height - MARGIN_PX
        if (position.y >= floor && vy > 0) {
          vy = -vy * BOUNCE_DAMPING
          vx *= 0.8
        }
        const left = bounds.x + MARGIN_PX
        const right = bounds.x + bounds.width - MARGIN_PX
        if (position.x <= left && vx < 0) vx = -vx * BOUNCE_DAMPING
        if (position.x >= right && vx > 0) vx = -vx * BOUNCE_DAMPING
        if (Math.abs(vy) < SETTLE_SPEED_PX_S && position.y >= floor) {
          vy = 0
          if (Math.abs(vx) < SETTLE_SPEED_PX_S) this.cancel()
        }
      })
    }, FRAME_MS)
  }
}
