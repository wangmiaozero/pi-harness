import type { CapabilityDefinition } from './types'
import type { McpInput } from '../agent-settings/schema'
export type McpTemplate = Omit<McpInput, 'root' | 'revision'>
export interface McpCatalogEntry {
  capability: CapabilityDefinition
  category: 'devtools' | 'web' | 'docs' | 'data' | 'productivity'
  template: McpTemplate
  requiresRoot?: boolean
  notes?: string
}
const local = (
  id: string,
  name: string,
  category: McpCatalogEntry['category'],
  description: string,
  command: string,
  args: string[]
): McpCatalogEntry => ({
  capability: {
    id: `mcp-catalog-${id}`,
    type: 'mcp',
    name,
    description,
    source: 'marketplace',
    integration: 'native-pi',
    tags: [category]
  },
  category,
  template: { id, type: 'stdio', command, args, enabled: true, exposure: 'codemode', description }
})
const remote = (
  id: string,
  name: string,
  category: McpCatalogEntry['category'],
  description: string,
  url: string
): McpCatalogEntry => ({
  capability: {
    id: `mcp-catalog-${id}`,
    type: 'mcp',
    name,
    description,
    source: 'marketplace',
    integration: 'native-pi',
    tags: [category]
  },
  category,
  template: { id, type: 'http', url, enabled: true, exposure: 'codemode', description }
})
/** Reviewed configuration templates. Saving a template does not execute its command. */
export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  local('memory', 'Memory', 'productivity', 'Knowledge graph memory across conversations.', 'npx', [
    '-y',
    '@modelcontextprotocol/server-memory'
  ]),
  local(
    'sequential-thinking',
    'Sequential Thinking',
    'productivity',
    'Step-by-step reasoning for complex problems.',
    'npx',
    ['-y', '@modelcontextprotocol/server-sequential-thinking']
  ),
  local(
    'everything',
    'Everything',
    'docs',
    'Reference server for trying MCP tools and resources.',
    'npx',
    ['-y', '@modelcontextprotocol/server-everything']
  ),
  {
    ...local(
      'filesystem',
      'Filesystem',
      'data',
      'Read and write files in your selected project folder.',
      'npx',
      ['-y', '@modelcontextprotocol/server-filesystem']
    ),
    requiresRoot: true
  },
  local(
    'playwright',
    'Playwright',
    'web',
    'Browse pages, interact with forms and capture screenshots.',
    'npx',
    ['-y', '@playwright/mcp@latest']
  ),
  local(
    'context7',
    'Context7',
    'docs',
    'Find current documentation and code examples for libraries.',
    'npx',
    ['-y', '@upstash/context7-mcp']
  ),
  local('fetch', 'Fetch', 'web', 'Read web pages as Markdown.', 'uvx', ['mcp-server-fetch']),
  local('git', 'Git', 'devtools', 'Inspect repository history, status and changes.', 'uvx', [
    'mcp-server-git'
  ]),
  local('time', 'Time', 'productivity', 'Look up times and convert between time zones.', 'uvx', [
    'mcp-server-time'
  ]),
  local('serena', 'Serena', 'devtools', 'Navigate and search code in large repositories.', 'uvx', [
    '--from',
    'git+https://github.com/oraios/serena',
    'serena',
    'start-mcp-server',
    '--context',
    'ide-assistant'
  ]),
  remote(
    'deepwiki',
    'DeepWiki',
    'docs',
    'Ask questions about the structure of public repositories.',
    'https://mcp.deepwiki.com/mcp'
  ),
  {
    ...remote(
      'notion',
      'Notion',
      'productivity',
      'Search and manage Notion pages and databases.',
      'https://mcp.notion.com/mcp'
    ),
    notes: 'Authorization is required by the service.',
    template: {
      id: 'notion',
      type: 'http',
      url: 'https://mcp.notion.com/mcp',
      enabled: false,
      exposure: 'codemode'
    }
  },
  remote('exa', 'Exa', 'web', 'Search the web and retrieve content.', 'https://mcp.exa.ai/mcp'),
  {
    ...remote(
      'github',
      'GitHub',
      'devtools',
      'Work with repositories, issues and pull requests.',
      'https://api.githubcopilot.com/mcp/'
    ),
    notes:
      'Set GITHUB_AUTHORIZATION in your environment to Bearer followed by your token before enabling.',
    template: {
      id: 'github',
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: '${GITHUB_AUTHORIZATION}' },
      enabled: false,
      exposure: 'codemode'
    }
  },
  {
    ...local('brave-search', 'Brave Search', 'web', 'Search the web with Brave.', 'npx', [
      '-y',
      '@modelcontextprotocol/server-brave-search'
    ]),
    notes: 'Requires BRAVE_API_KEY in the application environment.',
    template: {
      id: 'brave-search',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '${BRAVE_API_KEY}' },
      enabled: true,
      exposure: 'codemode'
    }
  }
]
