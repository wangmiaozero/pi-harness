import type { ArchitectureCanvasPalette } from '@shared/intelligence/schema'

let cachedSignature = ''
let cachedPalette: ArchitectureCanvasPalette | undefined

/** Resolve CSS colors locally; only bounded hex values cross into the native viewer. */
export function readArchitecturePalette(): ArchitectureCanvasPalette | undefined {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const colors = [
    '--bg-window',
    '--bg-workspace',
    '--bg-surface-raised',
    '--text-primary',
    '--text-secondary',
    '--accent'
  ].map((token) => style.getPropertyValue(token).trim())
  const signature = colors.join('|')
  if (signature === cachedSignature) return cachedPalette
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  function composite(color: string, under: string): string {
    context!.fillStyle = under
    context!.fillRect(0, 0, 1, 1)
    context!.fillStyle = color
    context!.fillRect(0, 0, 1, 1)
    return (
      '#' +
      [...context!.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
    )
  }
  const base = composite(colors[0], root.dataset.appearance === 'light' ? '#ffffff' : '#000000')
  const background = composite(colors[1], base)
  cachedPalette = {
    background,
    surface: composite(colors[2], background),
    foreground: composite(colors[3], background),
    muted: composite(colors[4], background),
    accent: composite(colors[5], background)
  }
  cachedSignature = signature
  return cachedPalette
}
