import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { customSkinManifestSchema } from '@shared/schemas/custom-skin'
import type {
  CustomSkinDescriptor,
  CustomSkinManifest,
  CustomSkinProjectResult
} from '@shared/types/custom-skin'
import { FileSystemError, ValidationError } from '../services/errors'
import { atomicWriteJson, atomicWriteText, readTextFile } from '../services/storage'

const MANIFEST_FILE = 'pi-harness-skin.json'
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_ASSET_BYTES = 12 * 1024 * 1024
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

const STARTER_MANIFEST: CustomSkinManifest = {
  $schema: './skin.schema.json',
  schemaVersion: 1,
  id: 'my-custom-skin',
  name: '我的自定义皮肤',
  version: '1.0.0',
  description: '由 Codex 或 Pi 按 Pi-Harness 声明式皮肤规范生成。',
  author: '',
  appearance: 'dark',
  assets: {},
  tokens: {
    window: '#111318',
    titlebar: '#171a21',
    sidebar: '#15181e',
    workspace: '#1b1f27',
    surface: '#20252e',
    surfaceRaised: '#272d38',
    hover: '#303845',
    selected: '#39465a',
    textPrimary: '#f3f5f7',
    textSecondary: '#c2c8d0',
    textTertiary: '#8f99a6',
    accent: '#6f9df4',
    accentHover: '#8ab0f7',
    accentActive: '#527fd6',
    accentBorder: '#5579ad',
    borderSubtle: 'rgba(130, 154, 190, 0.14)',
    borderDefault: 'rgba(130, 154, 190, 0.25)',
    borderStrong: 'rgba(130, 154, 190, 0.42)',
    controlBackground: '#1b2028',
    controlBorder: 'rgba(130, 154, 190, 0.28)',
    controlBorderHover: 'rgba(130, 154, 190, 0.5)'
  }
}

const STARTER_README = `# Pi-Harness 自定义皮肤项目

这个项目可直接交给 Codex 或 Pi 生成皮肤；完成后，在 Pi-Harness 中导入本项目目录即可。

## 最快使用方式

1. 用 Codex 或 Pi 打开本项目目录。
2. 复制下面代码块中的提示词，把最后一行替换为你的主题需求后发送。
3. AI 完成并校验后，打开 Pi-Harness 的“设置 → 主题 → 导入皮肤”。
4. 选择本项目目录，再点击新增的自定义皮肤卡片启用。

## 一键复制提示词

\`\`\`text
请在当前项目中生成一套可直接导入 Pi-Harness 的完整自定义皮肤。

执行要求：
1. 先完整阅读 AGENTS.md、SKIN_BRIEF.md、skin.schema.json 和 pi-harness-skin.json。
2. 只修改当前皮肤项目，不要修改 Pi-Harness 主程序，也不要在项目外创建文件。
3. 生成以下资源：
   - assets/wallpaper.webp：16:9 应用壁纸，需保证半透明面板上的文字仍清晰可读。
   - assets/portrait.webp：透明背景竖版角色图，四周保留安全边距；不需要角色时可以省略。
   - assets/preview.webp：16:10 主题卡片预览图，必须准确反映最终皮肤效果。
4. 根据图片同步完善 pi-harness-skin.json：设置唯一的 kebab-case id、名称、版本、明暗模式、资源相对路径和完整颜色令牌。
5. 图片只能使用 PNG、JPEG 或 WebP，单个文件不得超过 12 MiB；禁止外部链接、SVG、CSS、JavaScript、HTML、字体和可执行文件。
6. 完成后按 skin.schema.json 校验清单，检查全部资源存在且路径正确，并输出最终文件清单与校验结果。

我的主题需求：在这里写风格、人物、配色、时代、氛围和禁用元素。
\`\`\`

## 导入与更新

首次生成后直接导入本项目目录。后续修改时保持 \`pi-harness-skin.json\` 中的 \`id\` 不变，再次导入即可安全更新已安装皮肤。

外部 CSS、JavaScript、SVG、字体、HTML 和网络 URL 不会被导入或执行。
`

const STARTER_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://pi-harness.local/schemas/skin-v1.json',
  title: 'Pi-Harness Declarative Skin',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'name', 'version', 'appearance', 'tokens'],
  properties: {
    $schema: { type: 'string' },
    schemaVersion: { const: 1 },
    id: {
      type: 'string',
      minLength: 2,
      maxLength: 64,
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' },
    description: { type: 'string', maxLength: 240 },
    author: { type: 'string', maxLength: 80 },
    appearance: { enum: ['dark', 'light'] },
    assets: {
      type: 'object',
      additionalProperties: false,
      properties: {
        preview: { $ref: '#/$defs/asset' },
        wallpaper: { $ref: '#/$defs/asset' },
        portrait: { $ref: '#/$defs/asset' }
      }
    },
    tokens: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        [
          'window',
          'titlebar',
          'sidebar',
          'workspace',
          'surface',
          'surfaceRaised',
          'hover',
          'selected',
          'textPrimary',
          'textSecondary',
          'textTertiary',
          'accent',
          'accentHover',
          'accentActive',
          'accentBorder',
          'borderSubtle',
          'borderDefault',
          'borderStrong',
          'controlBackground',
          'controlBorder',
          'controlBorderHover'
        ].map((key) => [key, { $ref: '#/$defs/color' }])
      )
    }
  },
  $defs: {
    asset: {
      type: 'string',
      maxLength: 256,
      pattern: '^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$)).+\\.(?:png|jpe?g|webp)$'
    },
    color: {
      type: 'string',
      maxLength: 96,
      pattern: '^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch)\\([^;{}]+\\))$'
    }
  }
}

const STARTER_AGENTS = `# Pi-Harness skin agent instructions

- Only modify this skin project. Never edit the Pi-Harness application repository.
- Keep \`pi-harness-skin.json\` compatible with schemaVersion 1.
- Use lowercase kebab-case for \`id\`; never change it after users import the skin.
- Assets must be local PNG, JPEG, or WebP files under \`assets/\`.
- Do not add JavaScript, CSS, SVG, remote URLs, executable files, or embedded HTML.
- Keep each image below 12 MiB. Prefer WebP for wallpapers and PNG/WebP for transparent portraits.
- Wallpaper should remain readable behind translucent application panels.
- Portrait art should have transparent background and generous safe margins.
- Finish by validating every referenced asset path and summarizing manifest/token changes.
`

const STARTER_BRIEF = `# 皮肤设计需求

请使用 Codex 或 Pi，基于本项目的 \`AGENTS.md\` 和 \`pi-harness-skin.json\` 生成一套完整的 Pi-Harness 皮肤。

需要产出：

- 16:9 壁纸：\`assets/wallpaper.webp\`
- 竖版透明角色图：\`assets/portrait.webp\`
- 16:10 皮肤预览图：\`assets/preview.webp\`
- 与图片一致且对比度合格的颜色令牌

设计主题：在这里写你的风格、人物、配色、时代与氛围要求。

完成后把三个相对路径写入清单的 \`assets\` 字段，并确保没有外部链接或可执行内容。
`

export class CustomSkinService {
  constructor(private readonly installRoot: string) {}

  suggestedProjectPath(): string {
    return path.join(homedir(), 'code', 'my-pi-harness-skin')
  }

  async list(): Promise<CustomSkinDescriptor[]> {
    await fs.mkdir(this.installRoot, { recursive: true })
    const entries = await fs.readdir(this.installRoot, { withFileTypes: true })
    const skins: CustomSkinDescriptor[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      try {
        skins.push(await this.readInstalled(path.join(this.installRoot, entry.name)))
      } catch {
        // Ignore a damaged individual skin so one bad import cannot break Settings.
      }
    }
    return skins.sort((left, right) => left.name.localeCompare(right.name))
  }

  async has(id: string): Promise<boolean> {
    try {
      const manifest = await this.readManifest(path.join(this.installRoot, id, MANIFEST_FILE))
      return manifest.id === id
    } catch {
      return false
    }
  }

  async importProject(sourceRoot: string): Promise<CustomSkinDescriptor> {
    const source = await this.realDirectory(sourceRoot)
    const manifest = await this.readManifest(path.join(source, MANIFEST_FILE))
    const staging = path.join(this.installRoot, `.${manifest.id}.${randomUUID()}.staging`)
    const target = path.join(this.installRoot, manifest.id)
    const backup = path.join(this.installRoot, `.${manifest.id}.${randomUUID()}.backup`)

    await fs.mkdir(staging, { recursive: true })
    try {
      const normalized: CustomSkinManifest = { ...manifest, assets: {} }
      for (const [role, relativePath] of Object.entries(manifest.assets ?? {})) {
        if (!relativePath) continue
        const sourceAsset = await this.resolveAsset(source, relativePath)
        const extension = path.extname(sourceAsset).toLowerCase()
        const installedName = `${role}${extension}`
        await fs.copyFile(sourceAsset, path.join(staging, installedName))
        normalized.assets![role as keyof NonNullable<CustomSkinManifest['assets']>] = installedName
      }
      await atomicWriteJson(path.join(staging, MANIFEST_FILE), normalized)
      await fs.mkdir(this.installRoot, { recursive: true })
      const targetExists = await fs
        .stat(target)
        .then(() => true)
        .catch(() => false)
      if (targetExists) await fs.rename(target, backup)
      try {
        await fs.rename(staging, target)
      } catch (error) {
        if (targetExists) await fs.rename(backup, target).catch(() => undefined)
        throw error
      }
      if (targetExists) await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined)
      return await this.readInstalled(target)
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async createProject(targetPath: string): Promise<CustomSkinProjectResult> {
    const target = path.resolve(targetPath)
    if (target.includes('\0') || path.basename(target).startsWith('.')) {
      throw new ValidationError('皮肤项目路径无效')
    }
    const exists = await fs
      .stat(target)
      .then(() => true)
      .catch(() => false)
    if (exists) throw new ValidationError('目标目录已存在，请选择一个新目录')

    await fs.mkdir(path.join(target, 'assets'), { recursive: true })
    await atomicWriteJson(path.join(target, MANIFEST_FILE), STARTER_MANIFEST)
    await atomicWriteJson(path.join(target, 'skin.schema.json'), STARTER_SCHEMA)
    await atomicWriteText(path.join(target, 'README.md'), STARTER_README)
    await atomicWriteText(path.join(target, 'AGENTS.md'), STARTER_AGENTS)
    await atomicWriteText(path.join(target, 'SKIN_BRIEF.md'), STARTER_BRIEF)
    await atomicWriteText(path.join(target, '.gitignore'), '.DS_Store\nThumbs.db\n*.tmp\n*.log\n')
    await atomicWriteText(
      path.join(target, 'assets', 'README.md'),
      '将 preview、wallpaper、portrait 位图放在此目录。\n'
    )
    return { path: target, manifestPath: path.join(target, MANIFEST_FILE) }
  }

  private async readInstalled(root: string): Promise<CustomSkinDescriptor> {
    const manifest = await this.readManifest(path.join(root, MANIFEST_FILE))
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? null,
      author: manifest.author || null,
      appearance: manifest.appearance,
      tokens: manifest.tokens,
      previewDataUrl: await this.readAssetDataUrl(root, manifest.assets?.preview),
      wallpaperDataUrl: await this.readAssetDataUrl(root, manifest.assets?.wallpaper),
      portraitDataUrl: await this.readAssetDataUrl(root, manifest.assets?.portrait)
    }
  }

  private async readManifest(manifestPath: string): Promise<CustomSkinManifest> {
    const stat = await fs.stat(manifestPath).catch(() => null)
    if (!stat?.isFile()) throw new ValidationError(`缺少 ${MANIFEST_FILE}`)
    if (stat.size > MAX_MANIFEST_BYTES) throw new ValidationError('皮肤清单过大')
    const text = await readTextFile(manifestPath)
    let raw: unknown
    try {
      raw = JSON.parse(text ?? '')
    } catch {
      throw new ValidationError('皮肤清单不是有效 JSON')
    }
    const parsed = customSkinManifestSchema.safeParse(raw)
    if (!parsed.success) {
      throw new ValidationError('皮肤清单不符合规范', { issues: parsed.error.issues })
    }
    return parsed.data
  }

  private async realDirectory(candidate: string): Promise<string> {
    if (!candidate || candidate.includes('\0')) throw new ValidationError('皮肤项目路径无效')
    const resolved = await fs.realpath(candidate).catch(() => null)
    if (!resolved) throw new ValidationError('皮肤项目不存在')
    const stat = await fs.stat(resolved)
    if (!stat.isDirectory()) throw new ValidationError('请选择皮肤项目目录')
    return resolved
  }

  private async resolveAsset(root: string, relativePath: string): Promise<string> {
    const realRoot = await fs.realpath(root).catch(() => root)
    const candidate = path.resolve(realRoot, relativePath)
    const relative = path.relative(realRoot, candidate)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ValidationError('皮肤资源必须位于项目目录内')
    }
    const real = await fs.realpath(candidate).catch(() => null)
    if (!real) throw new ValidationError(`皮肤资源不存在：${relativePath}`)
    const realRelative = path.relative(realRoot, real)
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new ValidationError('皮肤资源不能通过符号链接指向项目外部')
    }
    const stat = await fs.stat(real)
    if (!stat.isFile()) throw new ValidationError(`皮肤资源不是文件：${relativePath}`)
    if (stat.size > MAX_ASSET_BYTES)
      throw new ValidationError(`皮肤资源超过 12 MiB：${relativePath}`)
    if (!MIME_BY_EXTENSION[path.extname(real).toLowerCase()]) {
      throw new ValidationError(`不支持的皮肤资源格式：${relativePath}`)
    }
    return real
  }

  private async readAssetDataUrl(root: string, relativePath?: string): Promise<string | null> {
    if (!relativePath) return null
    const file = await this.resolveAsset(root, relativePath)
    const mime = MIME_BY_EXTENSION[path.extname(file).toLowerCase()]
    if (!mime) throw new FileSystemError('无法识别皮肤资源类型')
    return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`
  }
}
