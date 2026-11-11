import fs from 'node:fs'
import path from 'node:path'
import { BIGFISH_CLIPS } from '../src/shared/pet/desktop'

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures')
const PORTRAIT = fs.readFileSync(path.join(FIXTURES, 'portrait.png'))
const SCENE = fs.readFileSync(path.join(FIXTURES, 'scene.png'))
const WEBP = fs.readFileSync(path.join(FIXTURES, 'pet-frame.webp'))
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwChRRRXxp+pn//Z',
  'base64'
)

interface ThemeVariant {
  id: string
  skinId: string
  name: string
  appearance: 'dark' | 'light'
  portrait: boolean
  accent: string
  sprite: string
  images?: Record<string, string>
}

interface ThemeFixture {
  id: string
  variants: ThemeVariant[]
  files: string[]
}

const THEMES: ThemeFixture[] = [
  theme('maid-white', [
    variant('maidWhite', 'maid-white', 'light', '#3868bd', 'assets/pico-maid-white.png', {
      '--market-scene-maid-white': 'assets/azure-patisserie-atelier-v2.png',
      '--market-preview-maid-white': 'assets/azure-patisserie-atelier-v2.png'
    })
  ]),
  theme('office', [
    variant('office', 'office-executive', 'dark', '#c5a176', 'assets/pico-office.png', {
      '--market-scene-office': 'assets/dusk-executive-suite-v2.png',
      '--market-preview-office': 'assets/dusk-executive-suite-v2.png'
    })
  ]),
  theme('noir-scholar', [
    variant('noirScholar', 'noir-scholar', 'dark', '#b18a50', 'assets/noir-scholar.png', {
      '--market-scene-noir': 'assets/noir-study.png',
      '--market-preview-noir': 'assets/noir-study.png'
    })
  ]),
  theme('moonlit-maid', [
    variant('moonlitMaid', 'moonlit-maid', 'light', '#806284', 'assets/moonlit-maid.png', {
      '--market-scene-moonlit': 'assets/moonlit-tea-room.png',
      '--market-preview-moonlit': 'assets/moonlit-tea-room.png'
    })
  ]),
  theme('ming-snow', [
    variant('mingSnow', 'ming-snow', 'dark', '#bd8b52', 'assets/snow-maiden.png', {
      '--market-scene-ming-snow': 'assets/snow-palace.png',
      '--market-preview-ming-snow': 'assets/snow-palace.png'
    })
  ], mingFiles()),
  theme('ming-moon', [
    variant('mingMoon', 'ming-moon', 'dark', '#b4493f', 'assets/moon-maiden.png', {
      '--market-scene-ming-moon': 'assets/moon-city.png',
      '--market-preview-ming-moon': 'assets/moon-city.png'
    })
  ], mingFiles()),
  theme(
    'zhang-juzheng',
    [
      variant(
        'zhangJuzhengSnow',
        'zhang-juzheng-snow',
        'dark',
        '#9e1b1b',
        'assets/zhang-juzheng.png',
        {
          '--market-scene-zhang': 'assets/snow-red-palace.png',
          '--market-preview-zhang': 'assets/snow-red-palace.png',
          '--market-zhang-titlebar-banner': 'assets/titlebar-snow-banner.png'
        }
      )
    ],
    [
      ...mingFiles(),
      'assets/calligraphy-scroll-governance.png',
      'assets/calligraphy-scroll-minister.png',
      'assets/calligraphy-scroll-spring.png',
      'assets/snow-plum-lantern.png',
      'assets/status-scroll-wangwei.png',
      'assets/titlebar-calligraphy-overlay.png'
    ]
  ),
  theme('starship', [
    variant('starshipCockpit', 'starship-cockpit', 'dark', '#67d8ff', 'assets/frost-navigator.png', {
      '--market-preview-starship': 'assets/frost-navigator.png',
      '--market-starship-interior': 'assets/cockpit-interior-foreground.png'
    })
  ], [
    'assets/deep-space.png',
    'assets/distant-planet.png',
    'assets/cockpit-interior-foreground.png',
    'assets/scout-ship-alpha.png',
    'assets/engine-radar-alpha.png',
    'assets/radar-base.png',
    'assets/cockpit-top-left.png',
    'assets/cockpit-top.png',
    'assets/cockpit-top-right.png',
    'assets/cockpit-left.png',
    'assets/cockpit-right.png',
    'assets/cockpit-bottom-left.png',
    'assets/cockpit-bottom.png',
    'assets/cockpit-bottom-right.png'
  ]),
  theme('deepseek', [
    variant('ropeWhale', 'rope-whale', 'dark', '#2f6fe0', 'assets/portraits/whale.png'),
    variant('ropeDeepseek', 'rope-deepseek', 'dark', '#3aa0ff', 'assets/portraits/deepseek.png'),
    variant('deepseekPoster', 'deepseek-poster', 'dark', '#3aa0ff', 'assets/wallpapers/default-background.jpg'),
    variant('deepseekDream', 'deepseek-dream', 'dark', '#3aa0ff', 'assets/wallpapers/wallpaper.png')
  ]),
  theme('phoebe', [variant('ropePhoebe', 'rope-phoebe', 'dark', '#f0c14a', 'assets/phoebe.png')]),
  theme('claude', [variant('ropeClaude', 'rope-claude', 'dark', '#e07a2f', 'assets/claude.png')]),
  theme('gemini', [variant('ropeGemini', 'rope-gemini', 'dark', '#7a5cff', 'assets/gemini.png')]),
  theme('gpt', [variant('ropeGpt', 'rope-gpt', 'dark', '#d7dde8', 'assets/gpt.png')]),
  theme('glm', [variant('ropeGlm', 'rope-glm', 'dark', '#7aa2ff', 'assets/glm.png')]),
  theme('grok', [variant('ropeGrok', 'rope-grok', 'dark', '#e2b340', 'assets/grok.png')]),
  theme('kimi', [variant('ropeKimi', 'rope-kimi', 'dark', '#9aa4ff', 'assets/kimi.png')]),
  theme('qwen', [variant('ropeQwen', 'rope-qwen', 'dark', '#5b8def', 'assets/qwen.png')])
]

function theme(id: string, variants: ThemeVariant[], files: string[] = []): ThemeFixture {
  return { id, variants, files }
}

function variant(
  id: string,
  skinId: string,
  appearance: 'dark' | 'light',
  accent: string,
  sprite: string,
  images?: Record<string, string>
): ThemeVariant {
  return { id, skinId, name: id, portrait: true, accent, sprite, appearance, images }
}

function mingFiles(): string[] {
  return [
    'assets/calligraphy-scroll.png',
    'assets/status-scroll.png',
    'assets/titlebar-calligraphy.png',
    'assets/plum-branch.png',
    'assets/frame-corner-v2.png',
    'assets/frame-rail-v2.png'
  ]
}

function writeAsset(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes)
}

function bytesFor(file: string, sprites: ReadonlySet<string>): Buffer {
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return JPEG
  return sprites.has(file) ? PORTRAIT : SCENE
}

interface MarketIndex {
  schemaVersion: 1
  themes: Record<string, IndexRecord>
  pets: Record<string, IndexRecord>
  addons: Record<string, never>
}

interface IndexRecord {
  name: string
  version: string
  sha256: string
  packId: string
  license: string
}

function readIndex(userData: string): MarketIndex {
  const indexPath = path.join(userData, 'market', 'index.json')
  if (!fs.existsSync(indexPath)) return { schemaVersion: 1, themes: {}, pets: {}, addons: {} }
  return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as MarketIndex
}

function writeIndex(userData: string, index: MarketIndex): void {
  const directory = path.join(userData, 'market')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index))
}

function indexRecord(name: string, packId: string): IndexRecord {
  return { name, version: '1.0.0', sha256: 'a'.repeat(64), packId, license: 'MIT' }
}

/** Minimal theme packs so portrait and starship surfaces can be selected in tests. */
export function installThemeFixtures(userData: string): void {
  const index = readIndex(userData)
  for (const pack of THEMES) {
    const root = path.join(userData, 'market', 'themes', pack.id)
    const files = new Set<string>(['preview.png', ...pack.files])
    const sprites = new Set(pack.variants.map((item) => item.sprite))
    const manifest = {
      formatVersion: 1,
      id: pack.id,
      name: pack.id,
      version: '1.0.0',
      author: 'wangmiao',
      description: pack.id,
      license: 'MIT',
      compatiblePiHarness: '>=2.4.0',
      preview: 'preview.png',
      variants: pack.variants.map((item) => {
        files.add(item.sprite)
        for (const file of Object.values(item.images ?? {})) files.add(file)
        return {
          id: item.id,
          skinId: item.skinId,
          name: item.name,
          appearance: item.appearance,
          portrait: item.portrait,
          accent: item.accent,
          frameWidth: 64,
          frameHeight: 64,
          portraitAsset: item.sprite,
          startup: false,
          cssImages: item.images
        }
      })
    }
    writeAsset(path.join(root, 'theme-pack.json'), Buffer.from(JSON.stringify(manifest)))
    for (const file of files) writeAsset(path.join(root, file), bytesFor(file, sprites))
    index.themes[pack.id] = indexRecord(`@piharness/theme-${pack.id}`, pack.id)
  }
  writeIndex(userData, index)
}

const LABELED_CLIPS = [
  { key: 'indesktop-lion-dance', label: '舞狮头', frames: 200 },
  { key: 'classic-hug', label: '拥抱', frames: 2 },
  { key: 'playful-sign-flip', label: '翻牌', frames: 8 }
] as const

/** Canvas jelly pets and a small BigFish pack. Official artwork stays in the market. */
export function installPetFixtures(userData: string): void {
  const petRoot = path.join(userData, 'petpacks')
  const source = path.resolve(import.meta.dirname, '../src/main/pet/fixtures')
  for (const name of [
    'tibot-circle',
    'tibot-rounded',
    'tibot-jelly',
    'tibot-triangle',
    'tibot-star',
    'tibot-ghost'
  ]) {
    fs.cpSync(path.join(source, name), path.join(petRoot, name), { recursive: true })
  }
  const clips: Record<string, unknown> = {}
  for (const key of BIGFISH_CLIPS) {
    clips[key] = { dir: `clips/${key}`, frames: 1, loop: true }
    writeAsset(path.join(petRoot, 'bigfish', 'clips', key, `${key}_001.webp`), WEBP)
  }
  for (const clip of LABELED_CLIPS) {
    clips[clip.key] = {
      dir: `clips/${clip.key}`,
      frames: clip.frames,
      loop: false,
      labels: { 'zh-CN': clip.label, 'en-US': clip.key }
    }
    for (let frame = 1; frame <= clip.frames; frame += 1) {
      writeAsset(
        path.join(
          petRoot,
          'bigfish',
          'clips',
          clip.key,
          `${clip.key}_${String(frame).padStart(3, '0')}.webp`
        ),
        WEBP
      )
    }
  }
  writeAsset(
    path.join(petRoot, 'bigfish', 'pet-pack.json'),
    Buffer.from(
      JSON.stringify({
        formatVersion: 1,
        id: 'bigfish',
        name: '大肥鱼',
        nameEn: 'BigFish',
        author: 'wangmiao',
        version: '1.0.0',
        license: 'MIT',
        baseWidth: 350,
        baseHeight: 300,
        fps: 12,
        defaultAnimation: 'idle',
        clips
      })
    )
  )
  const index = readIndex(userData)
  index.pets['@piharness/pet-bigfish'] = indexRecord('@piharness/pet-bigfish', 'bigfish')
  writeIndex(userData, index)
}
