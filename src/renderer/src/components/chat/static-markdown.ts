import { createMarkdownParser } from '@comark/vue/parse'

const emptyOptions: Record<string, unknown> = {}
const emptyPlugins: unknown[] = []
const parsers = new WeakMap<object, WeakMap<object, ReturnType<typeof createMarkdownParser>>>()

/** Reuse parser setup for static history; streaming keeps its per-message parser. */
export function parseStaticMarkdown(
  value: string,
  options: Record<string, unknown> = emptyOptions,
  plugins: unknown[] = emptyPlugins
): ReturnType<ReturnType<typeof createMarkdownParser>> {
  let byPlugins = parsers.get(options)
  if (!byPlugins) {
    byPlugins = new WeakMap()
    parsers.set(options, byPlugins)
  }
  let parser = byPlugins.get(plugins)
  if (!parser) {
    parser = createMarkdownParser({
      ...options,
      plugins: plugins as NonNullable<Parameters<typeof createMarkdownParser>[0]>['plugins']
    })
    byPlugins.set(plugins, parser)
  }
  // The parser's bounded previous-document slot is used only for streaming.
  // Static documents must never reuse nodes from another history entry.
  return parser(value, { streaming: false })
}
