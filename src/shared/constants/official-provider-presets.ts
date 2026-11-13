import type { ProviderPreset } from './provider-presets'

type CompatiblePreset = Pick<ProviderPreset, 'id' | 'name' | 'defaultBaseUrl' | 'keyUrl'> & {
  modelId?: string
  catalogGroup?: ProviderPreset['catalogGroup']
}

const vendors: readonly CompatiblePreset[] = [
  {
    id: 'kimi-code-global',
    name: 'Kimi Code (Global)',
    defaultBaseUrl: 'https://api.kimi.ai/coding/v1',
    keyUrl: 'https://www.kimi.ai/code/console',
    modelId: 'kimi-for-coding'
  },
  {
    id: 'qwen-international',
    name: 'Qwen (Global)',
    defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key'
  },
  {
    id: 'qwen-token-plan',
    name: 'Qwen Token Plan',
    defaultBaseUrl: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1',
    keyUrl: 'https://platform.qianwenai.com/home/analytics/token-plan/individual',
    modelId: 'qwen3.8-max'
  },
  {
    id: 'bailian-token-plan',
    name: 'Bailian Token Plan',
    defaultBaseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan/personal',
    modelId: 'qwen3.8-max'
  },
  {
    id: 'alibaba-token-plan',
    name: 'Alibaba Cloud Token Plan (Global)',
    defaultBaseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    keyUrl:
      'https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=globalset#/efm/token_plan',
    modelId: 'qwen3.8-max'
  },
  {
    id: 'qwencloud-token-plan',
    name: 'Qwen Cloud Token Plan',
    defaultBaseUrl: 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
    keyUrl: 'https://home.qwencloud.com/analytics/token-plan/individual',
    modelId: 'qwen3.8-max'
  },
  ...[
    ['ap-southeast-1', 'Singapore'],
    ['cn-beijing', 'Beijing'],
    ['eu-central-1', 'Frankfurt'],
    ['cn-hongkong', 'Hong Kong'],
    ['ap-northeast-1', 'Tokyo'],
    ['us-east-1', 'Virginia']
  ].map(([region, name]) => ({
    id: `qwencloud-${region}`,
    name: `Qwen Cloud (${name})`,
    defaultBaseUrl: `https://${region}.maas.qwencloudapi.com/compatible-mode/v1`,
    keyUrl: 'https://home.qwencloud.com/api-keys'
  })),
  {
    id: 'stepfun-global',
    name: 'StepFun (Global)',
    defaultBaseUrl: 'https://api.stepfun.ai/v1',
    keyUrl: 'https://platform.stepfun.ai/interface-key'
  },
  {
    id: 'step-plan-global',
    name: 'Step Plan (Global)',
    defaultBaseUrl: 'https://api.stepfun.ai/step_plan/v1',
    keyUrl: 'https://platform.stepfun.ai/interface-key'
  },
  {
    id: 'xiaomi-api',
    name: 'Xiaomi MiMo API',
    defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
    keyUrl: 'https://platform.xiaomimimo.com'
  },
  {
    id: 'longcat',
    name: 'LongCat',
    defaultBaseUrl: 'https://api.longcat.chat/openai/v1',
    keyUrl: 'https://longcat.chat/platform/api_keys',
    modelId: 'LongCat-2.5'
  },
  {
    id: 'baidu-qianfan',
    name: 'Baidu Qianfan API',
    defaultBaseUrl: 'https://qianfan.baidubce.com/v2',
    keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list'
  },
  {
    id: 'baidu-qianfan-personal',
    name: 'Baidu Qianfan Token Plan (Personal)',
    defaultBaseUrl: 'https://qianfan.baidubce.com/v2/tokenplan/personal',
    keyUrl: 'https://console.bce.baidu.com/qianfan/resource/token-plan',
    modelId: 'qianfan-code-latest'
  },
  {
    id: 'baidu-qianfan-team',
    name: 'Baidu Qianfan Token Plan (Enterprise)',
    defaultBaseUrl: 'https://qianfan.baidubce.com/v2/tokenplan/team',
    keyUrl: 'https://console.bce.baidu.com/qianfan/resource/token-plan',
    modelId: 'qianfan-code-latest'
  },
  {
    id: 'tencent-tokenhub',
    name: 'Tencent Cloud TokenHub (China)',
    defaultBaseUrl: 'https://tokenhub.tencentmaas.com/v1',
    keyUrl: 'https://console.cloud.tencent.com/tokenhub/apikey'
  },
  {
    id: 'tencent-tokenhub-global',
    name: 'Tencent Cloud TokenHub (Global)',
    defaultBaseUrl: 'https://tokenhub-intl.tencentmaas.com/v1',
    keyUrl: 'https://console.tencentcloud.com/tokenhub/apikey'
  },
  {
    id: 'tencent-token-plan',
    name: 'Tencent Cloud Token Plan (China)',
    defaultBaseUrl: 'https://tokenhub.tencentmaas.com/plan/v3',
    keyUrl: 'https://console.cloud.tencent.com/tokenhub/tokenplan',
    modelId: 'tc-code-latest'
  },
  {
    id: 'tencent-token-plan-global',
    name: 'Tencent Cloud Token Plan (Global Enterprise)',
    defaultBaseUrl: 'https://tokenhub-intl.tencentmaas.com/plan/v3',
    keyUrl: 'https://console.tencentcloud.com/tokenhub/apikey'
  },
  {
    id: 'huaweicloud',
    name: 'Huawei Cloud MaaS',
    defaultBaseUrl: 'https://api.modelarts-maas.com/openai/v1',
    keyUrl: 'https://console.huaweicloud.com/modelarts/?#/model-studio/authmanage'
  },
  {
    id: 'huaweicloud-token-plan',
    name: 'Huawei Cloud MaaS Token Plan',
    defaultBaseUrl: 'https://api.modelarts-maas.com/plan/v2',
    keyUrl: 'https://console.huaweicloud.com/modelarts/?#/model-studio/authmanage',
    modelId: 'deepseek-v4.1-flash'
  },
  {
    id: 'ark-agent-plan',
    name: 'Volcengine Ark Agent Plan',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    keyUrl: 'https://ark.volcengine.com/region:cn-beijing/apikey',
    modelId: 'ark-code-latest'
  },
  {
    id: 'bedrock',
    name: 'Amazon Bedrock (Runtime)',
    defaultBaseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1',
    keyUrl: 'https://console.aws.amazon.com/bedrock/home#/api-keys'
  },
  {
    id: 'bedrock-mantle',
    name: 'Amazon Bedrock (Mantle)',
    defaultBaseUrl: 'https://bedrock-mantle.us-east-1.api.aws/v1',
    keyUrl: 'https://console.aws.amazon.com/bedrock/home#/api-keys'
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    defaultBaseUrl: 'https://ollama.com/v1',
    keyUrl: 'https://ollama.com/settings/keys'
  }
]

const relays: readonly CompatiblePreset[] = [
  {
    id: 'gmicloud',
    name: 'GMI Cloud',
    defaultBaseUrl: 'https://api.gmi-serving.com/v1',
    keyUrl: 'https://console.gmicloud.ai'
  },
  {
    id: 'kilo',
    name: 'Kilo Gateway',
    defaultBaseUrl: 'https://api.kilo.ai/api/openrouter',
    keyUrl: 'https://app.kilo.ai'
  },
  {
    id: 'commandcode',
    name: 'Command Code Provider API',
    defaultBaseUrl: 'https://api.commandcode.ai/provider/v1',
    keyUrl: 'https://commandcode.ai/settings/keys'
  },
  {
    id: 'fireworks-nexus',
    name: 'Fireworks Nexus',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    keyUrl: 'https://nexus.fireworks.ai/settings/api-keys',
    modelId: 'auto'
  },
  {
    id: '302ai',
    name: '302.AI',
    defaultBaseUrl: 'https://api.302.ai/v1',
    keyUrl: 'https://302.ai/api-keys/list'
  },
  {
    id: 'cherryin',
    name: 'CherryIN',
    defaultBaseUrl: 'https://open.cherryin.net/v1',
    keyUrl: 'https://open.cherryin.net/console/token'
  }
]

const compatiblePresets: readonly CompatiblePreset[] = [
  ...vendors,
  ...relays.map((preset) => ({ ...preset, catalogGroup: 'relay' as const })),
  {
    id: 'omlx',
    name: 'oMLX',
    defaultBaseUrl: 'http://localhost:8000/v1',
    keyUrl: 'http://localhost:8000/admin'
  }
]

export const OFFICIAL_PROVIDER_PRESETS: readonly ProviderPreset[] = compatiblePresets.map(
  ({ modelId, ...preset }) => ({
    ...preset,
    protocol: 'openai-completions',
    authHeader: true,
    placeholderApiKey: preset.keyUrl ? 'API key' : '',
    defaultModelId: modelId ?? '',
    models: modelId ? [{ id: modelId, name: modelId }] : [],
    documentation: '',
    sources: []
  })
)
