import { expect, it } from 'vitest'
import security from '@comark/vue/plugins/security'
import { render } from '@comark/vue/render'
import { parseStaticMarkdown } from './static-markdown'
import { markdownOptions, markdownPlugins } from './message-markdown'

it('keeps concurrently parsed static documents separate while reusing the parser', async () => {
  const options = { registerDefaultPlugins: false }
  const plugins = [security({ allowedTags: ['h1', 'p', 'a'], allowedProtocols: ['https'] })]
  const results = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      parseStaticMarkdown(
        `# Heading ${index}\n\n[link](https://example.com/${index})`,
        options,
        plugins
      )
    )
  )
  for (let index = 0; index < results.length; index++) {
    expect(JSON.stringify(results[index].nodes)).toContain(`Heading ${index}`)
    expect(JSON.stringify(results[index].nodes)).toContain(`https://example.com/${index}`)
    expect(JSON.stringify(results[index].nodes)).not.toContain(`Heading ${index + 100}`)
  }
  const next = await parseStaticMarkdown('[blocked](javascript:alert(1))', options, plugins)
  expect(await render(next, { format: 'text/html' })).not.toContain('href="javascript:')
  expect(JSON.stringify(next.nodes)).not.toContain('Heading')
})

it('renders local Markdown anchors without letting them load local URLs', async () => {
  const markdown = [
    '[Local file](file:///workspace/file.md#L4)',
    '![Local image](file:///workspace/secret.png)',
    '[Blocked](javascript:alert(1))',
    '[Website](https://example.invalid/)'
  ].join('\n\n')
  const document = await parseStaticMarkdown(markdown, markdownOptions, markdownPlugins)
  const html = await render(document, { format: 'text/html' })
  expect(html).toContain('href="#workspace-file=%2Fworkspace%2Ffile.md&amp;line=4"')
  expect(html).toContain('href="https://example.invalid/"')
  expect(html).not.toContain('src="file:')
  expect(html).not.toContain('href="javascript:')
})
