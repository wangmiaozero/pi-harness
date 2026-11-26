import type { Markdown } from '@comark/vue'
import security from '@comark/vue/plugins/security'
import taskList from '@comark/vue/plugins/task-list'
import { visit } from '@comark/vue/utils'
import { parseMessageFileLink } from './message-file-link'

// One immutable policy/configuration identity for all historical messages.
export const markdownOptions = {
  registerDefaultPlugins: false
}
type MarkdownPlugin = NonNullable<InstanceType<typeof Markdown>['$props']['plugins']>[number]
export const markdownPlugins: MarkdownPlugin[] = [
  taskList(),
  {
    name: 'workspace-file-links',
    markdownItPlugins: [
      (parser) => {
        const validateLink = parser.validateLink.bind(parser)
        // File anchors are rewritten before security runs. Local image sources
        // still pass through the unchanged protocol allowlist.
        parser.validateLink = (href: string) => /^file:/i.test(href) || validateLink(href)
      }
    ],
    post(document) {
      visit(
        document.tree,
        (node) => Array.isArray(node) && node[0] === 'a',
        (node) => {
          if (!Array.isArray(node) || typeof node[1].href !== 'string') return
          const file = parseMessageFileLink(node[1].href)
          if (!file) return
          const params = new URLSearchParams({ 'workspace-file': file.path })
          if (file.line) params.set('line', String(file.line))
          node[1].href = `#${params}`
        }
      )
    }
  },
  security({
    allowedTags: [
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      's',
      'code',
      'pre',
      'blockquote',
      'hr',
      'br',
      'a',
      'img',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'input'
    ],
    allowedProtocols: ['http', 'https', 'mailto'],
    allowDataImages: false
  })
]
