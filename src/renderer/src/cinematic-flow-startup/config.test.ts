import { describe, expect, it } from 'vitest'
import {
  BRIEF_FLOW,
  FLOW_TIMELINE as T,
  briefFlowTime,
  flowResolution,
  flowStage,
  irisRadius
} from './config'

describe('Cinematic Flow timeline', () => {
  it('compresses the default flow without skipping the title or logo', () => {
    expect(briefFlowTime(0)).toBe(T.seed)
    expect(flowStage(briefFlowTime(2300))).toBe('title')
    expect(flowStage(briefFlowTime(4300))).toBe('mark')
    expect(briefFlowTime(BRIEF_FLOW.iris)).toBe(T.iris)
    expect(briefFlowTime(BRIEF_FLOW.end)).toBe(T.iris)
  })

  it.each([
    [0, 'seed'],
    [T.unfold, 'unfold'],
    [T.lettering, 'lettering'],
    [T.title, 'title'],
    [T.vortex, 'vortex'],
    [T.mark, 'mark']
  ])('starts the expected scene at %d ms', (time, expected) => {
    expect(flowStage(time as number)).toBe(expected)
  })

  it('clears the corners of portrait and ultrawide windows at the end of the iris', () => {
    for (const [width, height] of [
      [300, 1000],
      [3840, 700]
    ]) {
      expect(irisRadius(width, height, 0)).toBe(0)
      expect(irisRadius(width, height, 0.8)).toBeGreaterThan(irisRadius(width, height, 0.2))
      expect(irisRadius(width, height, 1)).toBeGreaterThan(Math.hypot(width, height) / 2)
    }
  })

  it('limits the pixel count on Retina displays and further reduces it in economy mode', () => {
    const area = 3840 * 2160
    const high = flowResolution(3840, 2160, 3, false)
    const low = flowResolution(3840, 2160, 3, true)
    expect(area * high ** 2).toBeLessThanOrEqual(2_750_001)
    expect(area * low ** 2).toBeLessThanOrEqual(1_050_001)
    expect(low).toBeLessThan(high)
    expect(flowResolution(600, 400, 1, false)).toBe(1)
  })
})
