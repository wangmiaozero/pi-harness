/** Use Pi's native compaction lifecycle for both SDK and standalone sessions. */
export function installCompactionPolicy(pi, resolveDefaults, compactNative) {
  let previous
  let applied
  function restore() {
    const level = previous
    previous = undefined
    if (level !== undefined && pi.getThinkingLevel() === applied) pi.setThinkingLevel(level)
    applied = undefined
  }
  pi.on('session_before_compact', (event, ctx) => {
    // Summary reasoning shares the model's output limit with the actual summary.
    // Only disable reasoning when the model explicitly permits it. Unknown and
    // always-on reasoning models use low; Pi clamps this to their supported levels.
    previous = pi.getThinkingLevel()
    const canDisable =
      ctx.model?.reasoning === false || typeof ctx.model?.thinkingLevelMap?.off === 'string'
    pi.setThinkingLevel(canDisable ? 'off' : 'low')
    applied = pi.getThinkingLevel()
    if (ctx.model && resolveDefaults && compactNative) return summarize(event, ctx)
  })
  pi.on('session_compact', restore)
  pi.on('session_compact_failed', restore)
  pi.on('session_shutdown', restore)

  async function summarize(event, ctx) {
    const defaults = await resolveDefaults(ctx.model)
    if (!defaults) return
    const model = {
      ...ctx.model,
      contextWindow: defaults.contextWindow ?? ctx.model.contextWindow,
      reasoning: defaults.reasoning ?? ctx.model.reasoning,
      thinkingLevelMap: defaults.thinkingLevels ?? ctx.model.thinkingLevelMap,
      ...(defaults.forceEffort && ctx.model.api === 'openai-completions'
        ? {
            compat: { ...ctx.model.compat, supportsReasoningEffort: true, thinkingFormat: 'openai' }
          }
        : {})
    }
    const level =
      !model.reasoning || typeof model.thinkingLevelMap?.off === 'string' ? 'off' : 'low'
    // A short normal reply limit must not also cap the recovery checkpoint.
    // Only verified channel limits permit raising this request-specific budget.
    const room = model.contextWindow - event.preparation.tokensBefore - 4096
    if (room <= 0) return
    for (let attempt = 0; attempt < 2; attempt++) {
      event.signal.throwIfAborted()
      const limit = Math.min(defaults.maxOutputTokens, attempt ? 32768 : 16384, Math.floor(room))
      const summaryModel = { ...model, maxTokens: limit }
      const focus = [
        event.customInstructions,
        `Write a complete concise checkpoint in at most ${attempt ? 800 : 1600} words. Preserve the user's goal, constraints, decisions, unfinished work, essential file paths and errors. Do not reproduce tool output or logs.`
      ]
        .filter(Boolean)
        .join('\n\n')
      try {
        return {
          compaction: await compactNative(
            event.preparation,
            summaryModel,
            undefined,
            undefined,
            focus,
            event.signal,
            level,
            (requestModel, context, options) =>
              ctx.modelRegistry.streamSimple(requestModel, context, {
                ...options,
                maxTokens: limit
              })
          )
        }
      } catch (error) {
        // Retry only a provably incomplete summary, never authentication, policy,
        // cancellation or arbitrary provider failures. Pi still owns validation
        // and checkpoint persistence, including final failure handling.
        if (
          event.signal.aborted ||
          attempt ||
          !String(error).includes('generation hit the token cap and the summary is incomplete')
        )
          throw error
      }
    }
  }
}
