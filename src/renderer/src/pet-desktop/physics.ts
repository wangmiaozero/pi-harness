/** Short inertial throws; a normal drag stays where the user releases it. */
export interface Vec2 {
  x: number
  y: number
}

const THROW_SPEED_PX_S = 650
const SETTLE_SPEED_PX_S = 40
const FRAME_MS = 16
const DAMPING = 0.9

export class ReleasePhysics {
  private timer: number | null = null
  private generation = 0

  constructor(
    private readonly moveBy: (dx: number, dy: number) => Promise<Vec2 | null>,
    private readonly onSettle: () => void = () => {}
  ) {}

  get active(): boolean {
    return this.timer !== null
  }

  cancel(): void {
    this.generation += 1
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  launch(velocity: Vec2): void {
    this.cancel()
    if (
      !Number.isFinite(velocity.x) ||
      !Number.isFinite(velocity.y) ||
      Math.hypot(velocity.x, velocity.y) < THROW_SPEED_PX_S
    )
      return
    const generation = this.generation
    let vx = Math.max(-2400, Math.min(2400, velocity.x))
    let vy = Math.max(-2400, Math.min(2400, velocity.y))
    let previous: Vec2 | null = null
    const step = async () => {
      if (generation !== this.generation) return
      vx *= DAMPING
      vy *= DAMPING
      try {
        const position = await this.moveBy(
          Math.round((vx * FRAME_MS) / 1000),
          Math.round((vy * FRAME_MS) / 1000)
        )
        if (generation !== this.generation) return
        // Main clamps the complete window into the work area. Stop at walls.
        const blocked =
          previous && position && position.x === previous.x && position.y === previous.y
        previous = position
        if (!position || blocked || Math.hypot(vx, vy) < SETTLE_SPEED_PX_S) {
          this.cancel()
          this.onSettle()
          return
        }
        this.timer = window.setTimeout(() => {
          void step()
        }, FRAME_MS)
      } catch {
        if (generation !== this.generation) return
        this.cancel()
        this.onSettle()
      }
    }
    this.timer = window.setTimeout(() => {
      void step()
    }, FRAME_MS)
  }
}
