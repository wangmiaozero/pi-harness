/** Use Pi's native compaction lifecycle for both SDK and standalone sessions. */
export function installCompactionPolicy(pi) {
  let previous
  let applied
  function restore() {
    const level = previous
    previous = undefined
    if (level !== undefined && pi.getThinkingLevel() === applied) pi.setThinkingLevel(level)
    applied = undefined
  }
  pi.on('session_before_compact', (_event, ctx) => {
    // Summary reasoning shares the model's output limit with the actual summary.
    // Only disable reasoning when the model explicitly permits it. Unknown and
    // always-on reasoning models use low; Pi clamps this to their supported levels.
    previous = pi.getThinkingLevel()
    const canDisable =
      ctx.model?.reasoning === false || typeof ctx.model?.thinkingLevelMap?.off === 'string'
    pi.setThinkingLevel(canDisable ? 'off' : 'low')
    applied = pi.getThinkingLevel()
  })
  pi.on('session_compact', restore)
  pi.on('session_compact_failed', restore)
  pi.on('session_shutdown', restore)
}
