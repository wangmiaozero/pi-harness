import type { Markdown } from '@comark/vue'
import security from '@comark/vue/plugins/security'
import taskList from '@comark/vue/plugins/task-list'

// One immutable policy/configuration identity for all historical messages.
export const markdownOptions = {
  registerDefaultPlugins: false
}
type MarkdownPlugin = NonNullable<InstanceType<typeof Markdown>['$props']['plugins']>[number]
export const markdownPlugins: MarkdownPlugin[] = [
  taskList(),
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
