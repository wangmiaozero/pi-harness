import { formatSkillInvocationSummary } from '../skills/skill-invocation'

const GENERIC =
  /^(?:hi|hello|hey|你好|您好|在吗|请继续|继续|继续吧|好的|谢谢|ok|okay|continue|please continue|帮我提交代码推送|提交代码|出bug了)[!！?？。\s]*$/i
const TOPICS = [
  { match: /主题|theme|palette|圆角|配色/i, zh: '调整界面主题', en: 'Refine application themes' },
  {
    match: /会话.*(?:切换|标题|重命名)|session.*(?:switch|title|name)/i,
    zh: '修复会话与标题',
    en: 'Improve session navigation'
  },
  { match: /安装|install|bootstrap/i, zh: '排查安装问题', en: 'Resolve installation issues' },
  { match: /release|发布|打包|packag/i, zh: '准备项目发布', en: 'Prepare project release' }
]

/** A local, bounded preview until a conversation has enough context for a model title. */
export function summarizeSessionTitle(texts: readonly string[]): string {
  const text = texts
    .map((text) => formatSkillInvocationSummary(text))
    .join('\n')
    .slice(0, 32_000)
  const chinese = /[\u3400-\u9fff]/u.test(text)
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|tmp|var)\/)[^\s`，。]+/g, '')
  const candidates = cleaned
    .split(/[\n。！？!?]+/)
    .map((line) =>
      line
        .replace(/^\s*(?:#{1,6}\s*|[-*]\s+|\d+[.、]\s*)/, '')
        .replace(/^[`\s]+|[`\s]+$/g, '')
        .replace(/^(?:请(?:你)?|帮我|麻烦(?:你)?|能否|可以)(?:帮忙|帮我)?\s*/u, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(
      (line) =>
        line.length > 2 &&
        !GENERIC.test(line) &&
        !/^(?:项目[：:]|本地项目|你是一名|Run |(?:pnpm|npm|git|cd)\s)/i.test(line)
    )
  const candidate =
    candidates.find((line) =>
      /重构|修复|实现|优化|排查|添加|更新|配置|设计|build|fix|implement|refactor|update|improve/i.test(
        line
      )
    ) ?? candidates[0]
  if (candidate) {
    const short = candidate
      .split(/[，,；;]/)[0]!
      .replace(/[：:]$/, '')
      .trim()
    if (Array.from(short).length <= 30) return short
    const topic = TOPICS.find((topic) => topic.match.test(short))
    if (topic) return chinese ? topic.zh : topic.en
    const words = short.split(/\s+/)
    if (words.length > 4) return words.slice(0, 6).join(' ').slice(0, 52)
    return Array.from(short).slice(0, 26).join('')
  }
  const topic = TOPICS.find((topic) => topic.match.test(text))
  if (topic) return chinese ? topic.zh : topic.en
  const repo = text.match(/github\.com\/[^/\s]+\/([\w.-]+)/i)?.[1]
  if (repo) return chinese ? `讨论 ${repo}` : `Discuss ${repo}`
  const greeting = texts.find((value) =>
    /^(?:hi|hello|hey|你好|您好)[!！。\s]*$/i.test(value.trim())
  )
  return greeting?.trim() || (chinese ? '日常对话' : 'Conversation')
}

export function cleanGeneratedSessionTitle(value: string): string | null {
  const title = value
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/^```(?:\w+)?\s*|\s*```$/g, '')
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^(?:title|标题)\s*[：:]\s*/i, '')
    .replace(/^["'“”`#\s]+|["'“”`\s。.!！]+$/g, '')
    .trim()
  if (
    !title ||
    Array.from(title).length > 60 ||
    /https?:\/\/|(?:\/(?:Users|home|tmp|private)\/)|^[{$<]/i.test(title)
  )
    return null
  return title
}
