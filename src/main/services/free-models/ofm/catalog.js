// Kilo catalog and reasoning menu adapted from Our Free Model (MIT).

// Kilo accepts OpenRouter-style reasoning settings. Some model families always
// think, including the auto routers, so their menu omits the Off setting.
const KILO_EFFORT_PATCH = { reasoning: { effort: '$effort' } }
const KILO_EFFORT_OFF_PATCH = { reasoning: { enabled: false } }
const KILO_REASONING_MANDATORY = [/^stepfun\//, /^liquid\//, /^thinkingmachines\//]
const KILO_NO_DISABLE_IDS = new Set(['kilo-auto/free', 'openrouter/free'])
// Kilo advertises 460,800 for Dots3, but its current route rejects that value.
// 262,144 completed both a tool request and the follow-up with its result.
const KILO_OUTPUT_CAPS = new Map([['dots-studio/dots-3-note-preview:free', 262144]])

/** The declared thinking menu for one listing row, or {} when the
 *  row does not declare reasoning support at all. */
function kiloEffortMenuFor(row) {
  const params = Array.isArray(row?.supported_parameters) ? row.supported_parameters : []
  if (!params.includes('reasoning')) return {}
  const id = String(row?.id ?? '')
  const canDisable =
    !KILO_REASONING_MANDATORY.some((pattern) => pattern.test(id)) && !KILO_NO_DISABLE_IDS.has(id)
  return {
    efforts: canDisable ? ['disabled', 'low', 'medium', 'high'] : ['low', 'medium', 'high'],
    effortDefault: 'high',
    effortPatch: KILO_EFFORT_PATCH,
    ...(canDisable ? { effortOffPatch: KILO_EFFORT_OFF_PATCH } : {}),
    canDisableThinking: canDisable
  }
}

/**
 * Is this raw listing row on Kilo's free pool? Everything else on that gateway
 * is a paid id that answers 401 keyless, and a picker full of guaranteed
 * refusals is worse than a short roster.
 */
export function isKiloFreeRow(row) {
  return (
    row?.isFree === true &&
    typeof row?.id === 'string' &&
    /^[a-zA-Z0-9][-a-zA-Z0-9_.:/]{0,199}$/.test(row.id)
  )
}

/**
 * The picker name: the listing's own name with the vendor prefix and the
 * `(free)` qualifier stripped. The ID remains the routing key.
 */
export function kiloDisplayName(row) {
  const raw = typeof row?.name === 'string' ? row.name.trim().slice(0, 200) : ''
  const bare = (raw !== '' ? raw : String(row?.id ?? ''))
    .replace(/^[^:]{1,40}:\s+/, '')
    .replace(/\s*\(free\)\s*$/i, '')
    .trim()
  const pretty =
    bare !== ''
      ? bare
      : String(row?.id ?? '')
          .replace(/[-_.]+/g, ' ')
          .trim()
          .split(' ')
          .map((word) =>
            /^\d/.test(word)
              ? word
              : word.toUpperCase() === word
                ? word.toUpperCase()
                : word.charAt(0).toUpperCase() + word.slice(1)
          )
          .join(' ')
  return pretty
}

function kiloEntryOf(row) {
  const context = number(row?.context_length) ?? number(row?.top_provider?.context_length) ?? 131072
  const output = Math.min(
    context,
    number(row?.top_provider?.max_completion_tokens) ?? 32768,
    KILO_OUTPUT_CAPS.get(row.id) ?? Infinity
  )
  const modalities = Array.isArray(row?.architecture?.input_modalities)
    ? row.architecture.input_modalities
    : []
  const menu = kiloEffortMenuFor(row)
  const params = Array.isArray(row.supported_parameters) ? row.supported_parameters : []
  return {
    id: String(row.id).trim(),
    name: kiloDisplayName(row),
    vision: modalities.includes('image'),
    reasoning: Boolean(menu.efforts),
    tools: params.includes('tools'),
    contextWindow: context,
    maxOutput: output,
    canDisableThinking: menu.canDisableThinking === true,
    ...(menu.efforts === undefined
      ? {}
      : {
          efforts: [...menu.efforts],
          effortDefault: menu.effortDefault,
          effortPatch: menu.effortPatch,
          ...(menu.effortOffPatch === undefined ? {} : { effortOffPatch: menu.effortOffPatch })
        })
  }
}

/**
 * Build the Kilo channel's catalog rows from its raw listing rows.
 * Rows that are not on the free pool, or that repeat an id, are dropped.
 */
export function buildKiloCatalog(rows) {
  const seen = new Set()
  const entries = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isKiloFreeRow(row)) continue
    const entry = kiloEntryOf(row)
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return entries
}

function number(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}
