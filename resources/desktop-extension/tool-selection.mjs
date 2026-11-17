const coding = new Set(['read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls'])
const readOnly = ['read', 'grep', 'find', 'ls']

export class ToolSelectionError extends Error {}

function toolSource(name, sourceInfo) {
  if (!sourceInfo) return undefined
  if (sourceInfo.path === 'builtin:mcp') return 'mcp'
  if (sourceInfo.path === `builtin:${name}` || sourceInfo.source === 'builtin') return 'builtin'
  if (sourceInfo.source === 'local' || sourceInfo.source === 'inline') return 'extension'
  return 'other'
}

export function listTools(pi) {
  const active = new Set(pi.getActiveTools())
  return pi.getAllTools().map(({ name, description, exposure, sourceInfo }) => {
    const source = toolSource(name, sourceInfo)
    return {
      name,
      description,
      active: active.has(name),
      ...(exposure === 'hidden' ? { available: false } : {}),
      ...(source ? { source } : {})
    }
  })
}

/** Applies desktop selections through Pi's registry, including tools callable by other tools. */
export function createToolSelection(pi) {
  let selection = null
  let suspendedExtensionTools = null
  const activeExtensions = () => pi.getActiveTools().filter((name) => !coding.has(name))
  const sameTools = (left, right) => {
    if (left.length !== right.length) return false
    const expected = new Set(right)
    return left.every((name) => expected.has(name))
  }

  const availableNames = () =>
    new Set(
      pi
        .getAllTools()
        .filter((tool) => tool.exposure !== 'hidden')
        .map((tool) => tool.name)
    )

  function apply(names, { preserveExtensionTools, custom, restore, initial, suspension } = {}) {
    const available = availableNames()
    const previous = pi.getActiveTools()
    const requested = [...new Set(names)]
    const restricted =
      preserveExtensionTools && (requested.length === 0 || sameTools(requested, readOnly))
    const enforced = custom || restricted || requested.length === 0
    let suspended = suspension === undefined ? suspendedExtensionTools : suspension
    if (!preserveExtensionTools && !custom) suspended = null
    if ((custom || restricted) && suspended === null) suspended = initial ? [] : activeExtensions()
    const preserved =
      preserveExtensionTools && !restricted && !initial ? (suspended ?? activeExtensions()) : []
    const chosen =
      preserveExtensionTools && !custom
        ? requested.map((name) =>
            name === 'bash' && !available.has(name) && available.has('powershell')
              ? 'powershell'
              : name
          )
        : requested.filter((name) => available.has(name))
    if (!restore && (!preserveExtensionTools || custom) && chosen.length !== requested.length)
      throw new ToolSelectionError('A selected tool is no longer available')

    const next = [...new Set([...chosen, ...preserved.filter((name) => available.has(name))])]
    try {
      pi.setActiveTools(next)
      if (custom && !sameTools(pi.getActiveTools(), next))
        throw new ToolSelectionError('Pi could not activate the selected tools')
    } catch (error) {
      pi.setActiveTools(previous)
      throw error
    }
    selection = enforced ? { names: new Set(requested), restricted } : null
    suspendedExtensionTools = custom || restricted ? suspended : null
  }

  function refresh() {
    if (!selection) return
    const available = availableNames()
    const next = [...selection.names].filter((name) => available.has(name))
    if (!sameTools(pi.getActiveTools(), next)) pi.setActiveTools(next)
  }

  return {
    apply,
    refresh,
    suspension: () => suspendedExtensionTools,
    allows(name) {
      if (!selection) return true
      if (!selection.names.has(name)) return false
      if (!selection.restricted) return true
      const tool = pi.getAllTools().find((entry) => entry.name === name)
      return tool?.sourceInfo?.path === `builtin:${name}`
    }
  }
}
