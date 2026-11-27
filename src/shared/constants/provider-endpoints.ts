import type { ProtocolId } from './protocols'

const arkRoot = 'https://ark.cn-beijing.volces.com/api'
export const ARK_AGENT_PLAN_OPENAI_URL = `${arkRoot}/plan/v3`

// Different products and regions of the same vendor. Keep each preset's
// model catalogue and API key page when switching between its endpoints.
export const PROVIDER_ENDPOINT_FAMILIES: readonly (readonly string[])[] = [
  ['doubao', 'ark-agent-plan', 'ark-code'],
  ['openai', 'openai-responses'],
  ['moonshot', 'moonshot-ai', 'kimi-for-coding', 'kimi-code-global'],
  ['zhipuai', 'zhipuai-coding-plan', 'zai', 'zai-coding-plan'],
  ['minimax', 'minimax-anthropic', 'minimax-cn', 'minimax-coding-plan', 'minimax-cn-coding-plan'],
  ['stepfun', 'stepfun-global', 'step-plan', 'step-plan-global'],
  [
    'xiaomi-api',
    'xiaomi',
    'xiaomi-token-plan-cn',
    'xiaomi-token-plan-ams',
    'xiaomi-token-plan-sgp'
  ],
  [
    'qwen',
    'qwen-international',
    'bailian-coding-plan',
    'qwen-token-plan',
    'bailian-token-plan',
    'alibaba-token-plan',
    'qwencloud-token-plan',
    'qwencloud-ap-southeast-1',
    'qwencloud-cn-beijing',
    'qwencloud-eu-central-1',
    'qwencloud-cn-hongkong',
    'qwencloud-ap-northeast-1',
    'qwencloud-us-east-1'
  ],
  ['baidu-qianfan', 'baidu-qianfan-personal', 'baidu-qianfan-team'],
  [
    'tencent-tokenhub',
    'tencent-tokenhub-global',
    'tencent-token-plan',
    'tencent-token-plan-global'
  ],
  ['huaweicloud', 'huaweicloud-token-plan'],
  ['bedrock', 'bedrock-mantle'],
  ['siliconflow', 'siliconflow-com'],
  ['ollama', 'ollama-cloud'],
  ['fireworks', 'fireworks-nexus'],
  ['flymux-openai', 'flymux-anthropic']
]

// Additional documented protocol endpoints. Default addresses remain in the
// provider catalog, including addresses used by saved configurations.
export const ADDITIONAL_PROVIDER_ENDPOINTS: readonly {
  presetId: string
  protocol: ProtocolId
  defaultBaseUrl: string
  authHeader?: boolean
}[] = [
  { presetId: 'doubao', protocol: 'anthropic-messages', defaultBaseUrl: `${arkRoot}/compatible` },
  { presetId: 'ark-agent-plan', protocol: 'anthropic-messages', defaultBaseUrl: `${arkRoot}/plan` },
  { presetId: 'ark-code', protocol: 'anthropic-messages', defaultBaseUrl: `${arkRoot}/coding` },
  {
    presetId: 'deepseek',
    protocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.deepseek.com/anthropic'
  },
  ...['zhipuai', 'zhipuai-coding-plan'].map((presetId) => ({
    presetId,
    protocol: 'anthropic-messages' as const,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/anthropic'
  })),
  ...['zai', 'zai-coding-plan'].map((presetId) => ({
    presetId,
    protocol: 'anthropic-messages' as const,
    defaultBaseUrl: 'https://api.z.ai/api/anthropic'
  })),
  {
    presetId: 'moonshot',
    protocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.moonshot.cn/anthropic'
  },
  {
    presetId: 'kimi-for-coding',
    protocol: 'openai-completions',
    defaultBaseUrl: 'https://api.kimi.com/coding/v1',
    authHeader: true
  },
  ...[
    ['minimax-anthropic', 'https://api.minimax.io'],
    ['minimax-coding-plan', 'https://api.minimax.io'],
    ['minimax-cn', 'https://api.minimax.cn'],
    ['minimax-cn-coding-plan', 'https://api.minimax.cn']
  ].flatMap(([presetId, origin]) => [
    {
      presetId,
      protocol: 'anthropic-messages' as const,
      defaultBaseUrl: `${origin}/anthropic`,
      authHeader: true
    },
    {
      presetId,
      protocol: 'openai-completions' as const,
      defaultBaseUrl: `${origin}/v1`,
      authHeader: true
    }
  ]),
  ...[
    ['qwen', 'dashscope.aliyuncs.com'],
    ['qwen-international', 'dashscope-intl.aliyuncs.com'],
    ['bailian-coding-plan', 'coding.dashscope.aliyuncs.com'],
    ['bailian-token-plan', 'token-plan.cn-beijing.maas.aliyuncs.com'],
    ['alibaba-token-plan', 'token-plan.ap-southeast-1.maas.aliyuncs.com']
  ].map(([presetId, host]) => ({
    presetId,
    protocol: 'anthropic-messages' as const,
    defaultBaseUrl: `https://${host}/apps/anthropic`
  })),
  {
    presetId: 'step-plan',
    protocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.stepfun.com/step_plan'
  },
  {
    presetId: 'xiaomi-api',
    protocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.xiaomimimo.com/anthropic'
  },
  {
    presetId: 'google',
    protocol: 'openai-completions',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    authHeader: true
  },
  {
    presetId: 'openrouter',
    protocol: 'anthropic-messages',
    defaultBaseUrl: 'https://openrouter.ai/api'
  },
  { presetId: 'xai', protocol: 'openai-responses', defaultBaseUrl: 'https://api.x.ai/v1' },
  { presetId: 'xai', protocol: 'openai-completions', defaultBaseUrl: 'https://us.api.x.ai/v1' },
  { presetId: 'xai', protocol: 'openai-responses', defaultBaseUrl: 'https://us.api.x.ai/v1' }
]
