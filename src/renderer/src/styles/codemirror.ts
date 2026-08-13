import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { EditorView } from '@codemirror/view'

/**
 * Shared CodeMirror treatment for Pi-Switch's Graphite workspaces.
 * The palette stays quiet: semantic hues are deliberately muted and every
 * editor shares the same typography, selection, gutter, and focus behavior.
 */
export const graphiteEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '12px',
      backgroundColor: 'var(--bg-workspace)',
      color: 'var(--text-primary)'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.55',
      overflow: 'auto'
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-surface)',
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-subtle)'
    },
    '.cm-gutterElement': { paddingLeft: '8px', paddingRight: '7px' },
    '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--editor-active-line)',
      color: 'var(--text-secondary)'
    },
    '.cm-content': { caretColor: 'var(--accent)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--accent-tint-strong)'
    },
    '.cm-tooltip': {
      background: 'var(--bg-surface-raised)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-popover)'
    }
  },
  { dark: true }
)

export const graphiteSyntaxHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.propertyName, tags.attributeName], color: 'var(--syntax-property)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
    { tag: [tags.number, tags.integer, tags.float], color: 'var(--syntax-number)' },
    { tag: [tags.bool, tags.null], color: 'var(--syntax-constant)' },
    {
      tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword],
      color: 'var(--syntax-keyword)'
    },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syntax-comment)' },
    { tag: [tags.heading, tags.strong], color: 'var(--syntax-heading)', fontWeight: '600' },
    { tag: [tags.emphasis], color: 'var(--syntax-emphasis)', fontStyle: 'italic' },
    { tag: [tags.link, tags.url], color: 'var(--syntax-link)' },
    { tag: [tags.invalid], color: 'var(--error)', textDecoration: 'underline' }
  ])
)
