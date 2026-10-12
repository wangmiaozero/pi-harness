import { afterEach, expect, it, vi } from 'vitest'
import { ARCHITECTURE_CONTROLS } from './viewer-controls'
import {
  architectureControlActionSchema,
  architectureViewerControlsSchema
} from '@shared/intelligence/schema'

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

it('keeps paging and fullscreen inside the existing graph dock, updates disabled state, and renders labels as text', () => {
  document.head.innerHTML = '<style>svg{width:100%;min-width:min(900px,100%)}</style>'
  document.body.innerHTML = '<nav class="diagram-nav"><button data-view="in">+</button></nav>'
  const command = vi.fn()
  const bridge = { command }
  const host = { architectureControls: bridge } as {
    architectureControls: typeof bridge
    piArchitectureControls?: { update: (input: unknown) => void }
  }
  const install = () =>
    new Function('document', 'window', 'architectureControls', ARCHITECTURE_CONTROLS)(
      document,
      host,
      bridge
    )
  install()
  const state = architectureViewerControlsSchema.parse({
    range: '1–48 / 100',
    focused: false,
    previousDisabled: true,
    nextDisabled: false,
    busy: false,
    fullscreen: false,
    labels: {
      previous: 'Previous',
      next: 'Next',
      overview: 'Overview',
      fullscreen: '<script>unsafe()</script>',
      exitFullscreen: 'Exit fullscreen'
    }
  })
  host.piArchitectureControls!.update(state)
  const dock = document.querySelector('.diagram-nav')!
  const previous = dock.querySelector<HTMLButtonElement>('[data-testid="architecture-previous"]')!
  const next = dock.querySelector<HTMLButtonElement>('[data-testid="architecture-next"]')!
  previous.click()
  expect(command).not.toHaveBeenCalled()
  next.click()
  expect(command).toHaveBeenCalledWith('next')
  expect(dock.querySelector('[data-testid="architecture-fullscreen"]')!.textContent).toBe(
    state.labels.fullscreen
  )
  expect(dock.querySelector('script')).toBeNull()
  host.piArchitectureControls!.update({ ...state, focused: true, busy: true, fullscreen: true })
  expect(next.hidden).toBe(true)
  expect(
    dock.querySelector<HTMLButtonElement>('[data-testid="architecture-overview"]')!.disabled
  ).toBe(true)
  expect(dock.querySelector('[data-testid="architecture-fullscreen"]')!.textContent).toBe(
    'Exit fullscreen'
  )
  for (const svg of dock.querySelectorAll('button svg')) {
    expect(getComputedStyle(svg).width).toBe('16px')
    expect(getComputedStyle(svg).minWidth).toBe('16px')
  }
  install()
  expect(dock.querySelectorAll('[data-testid="architecture-fullscreen"]')).toHaveLength(1)
})

it('does not add host controls to standalone exports, and rejects arbitrary commands and extra state fields', () => {
  document.body.innerHTML = '<nav class="diagram-nav"></nav>'
  new Function('document', 'window', ARCHITECTURE_CONTROLS)(document, {})
  expect(document.querySelector('[data-testid="architecture-fullscreen"]')).toBeNull()
  for (const action of ['shell', 'javascript:alert(1)', { action: 'fullscreen' }, null])
    expect(architectureControlActionSchema.safeParse(action).success).toBe(false)
  expect(architectureViewerControlsSchema.safeParse({ range: '1', shell: 'bad' }).success).toBe(
    false
  )
})
