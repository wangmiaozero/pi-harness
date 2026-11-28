export type StartupScheme = 'legacy' | 'flow'
export type WindowStartup = StartupScheme | '0'

export function chooseStartupScheme(random: () => number = Math.random): StartupScheme {
  return random() < 0.5 ? 'legacy' : 'flow'
}

export function createStartupSelector(random: () => number = Math.random) {
  let opened = false
  return (override?: StartupScheme): WindowStartup => {
    if (opened) return '0'
    opened = true
    return override ?? chooseStartupScheme(random)
  }
}

export function startupOverride(
  value: string | undefined,
  development: boolean,
  isolatedTest: boolean
): StartupScheme | undefined {
  if (!development && !isolatedTest) return undefined
  if (value === 'flow' || value === 'legacy') return value
  return isolatedTest ? 'legacy' : undefined
}
