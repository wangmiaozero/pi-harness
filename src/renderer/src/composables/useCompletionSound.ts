import { ref } from 'vue'

const STORAGE_KEY = 'pi-sound-enabled'
let sharedContext: AudioContext | null = null

function getContext(): AudioContext | null {
  if (sharedContext && sharedContext.state !== 'closed') return sharedContext
  try {
    sharedContext = new AudioContext()
    return sharedContext
  } catch {
    return null
  }
}

function playTone(context: AudioContext) {
  const now = context.currentTime
  for (const [index, frequency] of [523.25, 659.25].entries()) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    const start = now + index * 0.18
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45)
    oscillator.start(start)
    oscillator.stop(start + 0.45)
  }
}

export function useCompletionSound() {
  const stored = localStorage.getItem(STORAGE_KEY)
  const enabled = ref(stored === null ? false : stored === 'true')

  async function unlock(force = false) {
    if (!force && !enabled.value) return
    const context = getContext()
    if (context?.state === 'suspended') await context.resume().catch(() => undefined)
  }

  function setEnabled(next: boolean) {
    enabled.value = next
    localStorage.setItem(STORAGE_KEY, String(enabled.value))
    if (enabled.value) void unlock(true)
  }

  function toggle() {
    setEnabled(!enabled.value)
  }

  async function play() {
    if (!enabled.value) return
    const context = getContext()
    if (!context) return
    if (context.state === 'suspended') await context.resume().catch(() => undefined)
    if (context.state === 'running') playTone(context)
  }

  return { enabled, setEnabled, toggle, unlock, play }
}
