// Declared reasoning-effort mapping adapted from Our Free Model (MIT).

function instantiatePatch(patch, effort) {
  const walk = (value) => {
    if (typeof value === 'string') return value === '$effort' ? effort : value
    if (Array.isArray(value)) return value.map(walk)
    if (value !== null && typeof value === 'object') {
      const out = {}
      for (const [key, inner] of Object.entries(value)) out[key] = walk(inner)
      return out
    }
    return value
  }
  return walk(patch)
}

/** The declared default level id for a menu model, or its first level. */
function defaultEffort(model) {
  const levels = Array.isArray(model?.efforts) ? model.efforts : []
  if (levels.length === 0) return undefined
  return levels.includes(model.effortDefault) ? model.effortDefault : levels[0]
}

/**
 * The request-body patch a supported level turns into, or null when the
 * model declares no thinking menu at all.
 *
 * @param {string|undefined} level - the effort id the harness selected
 * @param {object} model - catalog entry
 * @returns {object|null}
 */
export function effortPatchFor(level, model) {
  if (!Array.isArray(model?.efforts) || model.efforts.length === 0) return null
  const chosen = model.efforts.includes(level) ? level : defaultEffort(model)
  if (chosen === 'disabled' && model.effortOffPatch !== undefined) {
    return instantiatePatch(model.effortOffPatch, chosen)
  }
  if (model.effortPatch === undefined) return null
  return instantiatePatch(model.effortPatch, chosen)
}
