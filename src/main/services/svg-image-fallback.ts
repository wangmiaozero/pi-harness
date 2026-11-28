import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom'
import { ValidationError } from './errors'

const MAX_SVG_LENGTH = 1_000_000
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
  'clippath',
  'mask',
  'filter',
  'fegaussianblur',
  'feflood',
  'feoffset',
  'feblend',
  'fecomposite',
  'fecolormatrix',
  'femerge',
  'femergenode',
  'fecomponenttransfer',
  'fefunca',
  'fefuncb',
  'fefuncg',
  'fefuncr',
  'feturbulence',
  'femorphology',
  'fedropshadow'
])
const REJECTED_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
  'handler'
])
const ALLOWED_ATTRIBUTES = new Set([
  'xmlns',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'id',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'transform',
  'fill',
  'stroke',
  'stroke-width',
  'fill-opacity',
  'stroke-opacity',
  'opacity',
  'clip-path',
  'mask',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'filter',
  'stdDeviation',
  'in',
  'in2',
  'result',
  'mode',
  'type',
  'values',
  'dx',
  'dy',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'flood-color',
  'flood-opacity',
  'color-interpolation-filters'
])

export function svgFallbackPrompt(prompt: string, width: number, height: number): string {
  return `Create a polished vector illustration for this request:\n\n${prompt}\n\nReturn only one SVG document. Use viewBox="0 0 ${width} ${height}" and width="${width}" height="${height}". Use only SVG geometry, gradients, paths, and text. Do not use scripts, CSS, links, external images, embedded data, foreignObject, animation, or event handlers. Make the composition detailed and visually complete.`
}

export function extractChatCompletionText(payload: unknown): string | null {
  const message = (payload as { choices?: Array<{ message?: unknown }> })?.choices?.[0]?.message
  if (!message || typeof message !== 'object') return null
  const record = message as Record<string, unknown>
  const texts = [record.content, record.reasoning, record.reasoning_content]
    .map(textContent)
    .filter((value): value is string => !!value)
  return texts.find((value) => /<svg\b/i.test(value)) ?? texts[0] ?? null
}

function textContent(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    const text = value
      .map((item) =>
        item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'
          ? (item as { text: string }).text
          : ''
      )
      .join('')
      .trim()
    return text || null
  }
  return null
}

export function sanitizeGeneratedSvg(raw: string, width: number, height: number): string {
  const svg = extractSvg(raw)
  if (!svg || svg.length > MAX_SVG_LENGTH) {
    throw new ValidationError('SVG fallback returned invalid image data')
  }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(svg)) {
    throw new ValidationError('SVG fallback returned unsafe image data')
  }

  const errors: string[] = []
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') errors.push(message)
    }
  }).parseFromString(svg, 'image/svg+xml')
  const root = document.documentElement
  if (errors.length || root?.tagName.toLowerCase() !== 'svg') {
    throw new ValidationError('SVG fallback returned malformed image data')
  }

  sanitizeElement(root)
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.setAttribute('viewBox', `0 0 ${width} ${height}`)
  return new XMLSerializer().serializeToString(root)
}

function extractSvg(raw: string): string | null {
  const match = raw.match(/<svg\b[\s\S]*<\/svg>/i)
  return match?.[0]?.trim() ?? null
}

function sanitizeElement(element: Element): void {
  const tag = element.tagName.toLowerCase()
  if (REJECTED_ELEMENTS.has(tag)) {
    throw new ValidationError(`SVG fallback used unsupported element: ${tag}`)
  }
  if (!ALLOWED_ELEMENTS.has(tag)) {
    element.parentNode?.removeChild(element)
    return
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name
    const value = attribute.value.trim()
    if (!ALLOWED_ATTRIBUTES.has(name) || /^on/i.test(name) || !safeAttributeValue(name, value)) {
      element.removeAttribute(name)
    }
  }

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1) sanitizeElement(child as Element)
    else if (child.nodeType !== 3) element.removeChild(child)
  }
}

function safeAttributeValue(name: string, value: string): boolean {
  if (/javascript:|data:|https?:|\/\//i.test(value)) return false
  if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z_][\w:.-]*\)$/i.test(value)) return false
  if (name === 'id') return /^[A-Za-z_][\w:.-]*$/.test(value)
  if (name === 'font-family') return /^[\w ,.'"-]{1,120}$/.test(value)
  return value.length <= 20_000
}
