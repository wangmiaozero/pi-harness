const iconFiles = import.meta.glob('../../assets/provider-icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const ICON_NAME: Record<string, string> = {
  chatgpt: 'openai',
  claude: 'claude-color',
  gemini: 'geminicli-color',
  copilot: 'githubcopilot',
  anthropic: 'claude-color',
  openai: 'openai',
  google: 'gemini-color',
  deepseek: 'deepseek-color',
  xai: 'xai',
  moonshot: 'kimi',
  'moonshot-ai': 'kimi',
  'kimi-for-coding': 'kimi',
  zhipuai: 'zhipu-color',
  'zhipuai-coding-plan': 'zhipu-color',
  zai: 'zai',
  'zai-coding-plan': 'zai',
  minimax: 'minimax-color',
  'minimax-cn': 'minimax-color',
  'minimax-anthropic': 'minimax-color',
  'minimax-coding-plan': 'minimax-color',
  'minimax-cn-coding-plan': 'minimax-color',
  stepfun: 'stepfun-color',
  'step-plan': 'stepfun-color',
  xiaomi: 'mimocode',
  qwen: 'qwen-color',
  'mistral-ai': 'mistral-color',
  groq: 'groq',
  openrouter: 'openrouter',
  'together-ai': 'together-color',
  fireworks: 'fireworks-color',
  siliconflow: 'siliconcloud-color',
  'siliconflow-com': 'siliconcloud-color',
  nvidia: 'nvidia-color',
  modelscope: 'modelscope-color',
  aihubmix: 'aihubmix-color',
  'vercel-ai-gateway': 'vercel',
  ollama: 'ollama',
  'lm-studio': 'lmstudio'
}

export function providerIcon(id: string) {
  if (!Object.hasOwn(ICON_NAME, id)) return undefined
  const name = ICON_NAME[id]
  const url = iconFiles[`../../assets/provider-icons/${name}.svg`]
  return url ? { url, monochrome: !name.endsWith('-color') } : undefined
}
