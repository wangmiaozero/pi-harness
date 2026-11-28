import markSvg from './pi-harness-mark.svg?raw'
import { FLOW_TITLE } from './config'

const SVG = 'http://www.w3.org/2000/svg'

// Open, monoline lettering designed for these words. Coordinates use a 31-unit
// cap height and a shared baseline, so the same strokes can be traced or bent.
const glyphs: Record<string, readonly [number, ...string[]]> = {
  W: [34, 'M1 1l7.5 30L17 8l8.5 23L33 1'],
  e: [19, 'M2 20h15.6c0-6-2.8-9.2-7.5-9.2S2 15 2 21s3.7 10.5 9.3 10.5c2.6 0 4.7-.8 6.2-2.3'],
  l: [7.6, 'M3.2 1v30'],
  c: [
    18,
    'M16 13.4a8.7 8.7 0 0 0-5.4-2.6C5.5 10.8 2 15.2 2 21s3.5 10.5 8.6 10.5c2.2 0 4.2-.8 5.6-2.4'
  ],
  o: [20, 'M10 10.8c4.6 0 8 4.3 8 10.4s-3.4 10.3-8 10.3S2 27.3 2 21.2s3.4-10.4 8-10.4Z'],
  m: [
    31,
    'M3 31V11',
    'M3 16c2-3.6 4.4-5.2 7.1-5.2 3.8 0 5.6 3 5.6 7V31',
    'M15.7 16.2c2-3.4 4.7-5.4 7.7-5.4 3.6 0 5.4 2.6 5.4 7.2v13'
  ],
  t: [13, 'M5.2 4v21c0 5.2 2 7.3 6.3 6', 'M1 11h11'],
  P: [23, 'M3 31V1h8.2C17.3 1 21 4.5 21 9.8s-3.7 8.8-9.8 8.8H3'],
  i: [8, 'M4 11v20', 'M3.8 4.2h.4'],
  '-': [13, 'M2 20h9'],
  H: [26, 'M3 1v30M23 1v30M3 15.8h20'],
  a: [
    20,
    'M17 31v-20',
    'M17 16c-2-3.4-4.4-5.2-7.1-5.2C5.3 10.8 2 15.2 2 21.2s3.3 10.3 7.9 10.3c3.1 0 5.5-1.9 7.1-5.2'
  ],
  r: [14, 'M3 31V11', 'M3 16.4c2-3.8 5.1-5.8 9-5.4'],
  n: [20, 'M3 31V11', 'M3 16.2c2.2-3.4 5-5.4 8-5.4 4 0 6 2.6 6 7.3V31'],
  s: [
    17,
    'M14.9 13.1a9 9 0 0 0-6-2.3c-3.9 0-6.4 2.1-6.4 5 0 3 2.1 4 6.1 5.2 4.6 1.4 6.1 2.6 6.1 5.4 0 3.1-2.7 5.1-6.4 5.1-2.7 0-5.1-.8-6.9-2.4'
  ],
  ' ': [12]
}

type Contour = { d: string; x: number }

function lettering() {
  const contours: Contour[] = []
  let advance = 0
  for (const glyph of FLOW_TITLE) {
    const [width, ...paths] = glyphs[glyph]
    // A new moveto starts a new strand. Joining strokes here would bridge the glyph.
    for (const d of paths) {
      for (const stroke of d.match(/M[^M]+/g) ?? []) contours.push({ d: stroke, x: advance })
    }
    advance += width + 1.4
  }
  return { contours, width: advance - 1.4 }
}

function sampleContours(
  contours: Contour[],
  count: number,
  points: number,
  cx: number,
  cy: number
) {
  const paths = contours.map(({ d, x }) => {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    return { path, x, length: path.getTotalLength(), pieces: 1 }
  })
  for (let remaining = count - paths.length; remaining > 0; remaining--) {
    // Split the longest remaining span while keeping every stroke represented.
    const path = paths.reduce((a, b) => (a.length / a.pieces >= b.length / b.pieces ? a : b))
    path.pieces++
  }
  return paths.flatMap(({ path, x, length, pieces }) =>
    Array.from({ length: pieces }, (_, piece) => {
      const samples = new Float32Array(points * 2)
      for (let i = 0; i < points; i++) {
        const point = path.getPointAtLength((length * (piece + i / (points - 1))) / pieces)
        samples[2 * i] = point.x + x - cx
        samples[2 * i + 1] = point.y - cy
      }
      return samples
    })
  )
}

export function prepareFlowShapes(count: number, points: number) {
  const title = lettering()
  const svg = new DOMParser().parseFromString(markSvg, 'image/svg+xml')
  const [left, top, width, height] = svg.documentElement
    .getAttribute('viewBox')!
    .split(' ')
    .map(Number)
  const mark = Array.from(svg.querySelectorAll('path'), (path) => ({
    d: path.getAttribute('d')!,
    x: 0
  }))
  if (!mark.length) throw new Error('Pi-Harness mark paths are missing')
  return {
    titleWidth: title.width,
    markWidth: width,
    markHeight: height,
    markCenterX: left + width / 2,
    markCenterY: top + height / 2,
    title: sampleContours(title.contours, count, points, title.width / 2, 16),
    mark: sampleContours(mark, count, points, left + width / 2, top + height / 2),
    markFill: new Path2D(mark.map(({ d }) => d).join(' '))
  }
}
