import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const app = path.resolve(import.meta.dirname, '../..')
const out = path.resolve(app, '../pi-Harness-packages')
const exec = promisify(execFile)
const mingDecor = [
  'panel-frame.png',
  'frame-rail-v2.png',
  'frame-corner-v2.png',
  'button-wood-v2.png',
  'button-parchment-v2.png',
  'button-cinnabar-v2.png',
  'calligraphy-scroll.png',
  'status-scroll.png',
  'plum-branch.png',
  'titlebar-calligraphy.png'
]
const startupFiles = [
  'background.mp4',
  'boot.mp4',
  'whale-girl-scan.mp4',
  'line-1.mp3',
  'line-2.mp3',
  'line-3.mp3',
  'line-4.mp3',
  'line-5.mp3',
  'line-6.mp3',
  'line-6-claude.mp3',
  'line-6-gemini.mp3',
  'line-6-gpt.mp3',
  'line-6-glm.mp3',
  'line-6-grok.mp3',
  'line-6-kimi.mp3',
  'line-6-qwen.mp3',
  'sfx-tick.mp3',
  'sfx-ticks-run.mp3'
]

await mkdir(out, { recursive: true })
await writeRoots()
for (const theme of themes()) await writeTheme(theme)
await writePets()
await copyTibotFixtures()
if (process.argv.includes('--remove-sources')) await removeSources()
console.log(`packages: ${out}`)

function themes() {
  const scene = (variable, file) => ({ [variable]: file })
  const mingFrames = {
    '--market-ming-panel-frame': 'assets/panel-frame.png',
    '--market-ming-frame-rail': 'assets/frame-rail-v2.png',
    '--market-ming-button-wood': 'assets/button-wood-v2.png',
    '--market-ming-button-parchment': 'assets/button-parchment-v2.png',
    '--market-ming-button-cinnabar': 'assets/button-cinnabar-v2.png'
  }
  return [
    character('deepseek', 'DeepSeek', 'MIT', true, [
      variant('ropeDeepseek', 'rope-deepseek', 'DeepSeek', '#3aa0ff', 330, 384, 'assets/portraits/deepseek.png'),
      variant('ropeWhale', 'rope-whale', 'DeepSeek Pro', '#2f6fe0', 384, 576, 'assets/portraits/whale.png'),
      variant('deepseekPoster', 'deepseek-poster', 'DeepSeek Work Mode', '#3aa0ff', 1920, 1080, 'assets/wallpapers/default-background.jpg', {
        '--market-scene-deepseek-poster': 'assets/wallpapers/default-background.jpg',
        '--market-preview-deepseek-poster': 'assets/wallpapers/default-background.jpg'
      }),
      variant('deepseekDream', 'deepseek-dream', 'DeepSeek Deep Dream', '#3aa0ff', 1290, 725, 'assets/wallpapers/wallpaper.png', {
        '--market-scene-deepseek-dream': 'assets/wallpapers/wallpaper.png',
        '--market-preview-deepseek-dream': 'assets/wallpapers/wallpaper.png'
      })
    ], [
      ['src/renderer/src/assets/themes/rope/deepseek.png', 'assets/portraits/deepseek.png'],
      ['src/renderer/src/assets/themes/rope/whale.png', 'assets/portraits/whale.png'],
      ['src/renderer/src/assets/themes/deepseek-poster/default-background.jpg', 'assets/wallpapers/default-background.jpg'],
      ['src/renderer/src/assets/themes/deepseek-dream/wallpaper.png', 'assets/wallpapers/wallpaper.png']
    ]),
    ...[
      ['claude', 'Claude', 'ropeClaude', '#e07a2f', 324, 384],
      ['gemini', 'Gemini', 'ropeGemini', '#7a5cff', 296, 384],
      ['gpt', 'GPT', 'ropeGpt', '#d7dde8', 320, 384],
      ['glm', 'GLM', 'ropeGlm', '#7aa2ff', 308, 384],
      ['grok', 'Grok', 'ropeGrok', '#e2b340', 311, 384],
      ['kimi', 'Kimi', 'ropeKimi', '#9aa4ff', 299, 384],
      ['qwen', 'Qwen', 'ropeQwen', '#5b8def', 307, 384]
    ].map(([id, title, style, accent, width, height]) =>
      character(id, title, 'MIT', true, [
        variant(style, `rope-${id}`, title, accent, width, height, `assets/${id}.png`)
      ], [[`src/renderer/src/assets/themes/rope/${id}.png`, `assets/${id}.png`]])
    ),
    character('phoebe', 'Phoebe', 'MIT', false, [
      variant('ropePhoebe', 'rope-phoebe', 'Phoebe', '#f0c14a', 283, 384, 'assets/phoebe.png')
    ], [['src/renderer/src/assets/themes/rope/phoebe.png', 'assets/phoebe.png']]),
    character('maid-white', 'Maid White', 'AGPL-3.0-only', false, [
      variant('maidWhite', 'maid-white', 'Maid Style', '#3868bd', 1024, 1536, 'assets/pico-maid-white.png', {
        '--market-scene-maid-white': 'assets/azure-patisserie-atelier-v2.png',
        '--market-preview-maid-white': 'assets/azure-patisserie-atelier-v2.png'
      })
    ], [
      ['src/renderer/src/assets/themes/maid-white/azure-patisserie-atelier-v2.png', 'assets/azure-patisserie-atelier-v2.png'],
      ['src/renderer/src/assets/mascot/pico-maid-white.png', 'assets/pico-maid-white.png']
    ]),
    character('office', 'Office', 'AGPL-3.0-only', false, [
      variant('office', 'office-executive', 'Office Style', '#c5a176', 1024, 1536, 'assets/pico-office.png', {
        '--market-scene-office': 'assets/dusk-executive-suite-v2.png',
        '--market-preview-office': 'assets/dusk-executive-suite-v2.png'
      })
    ], [
      ['src/renderer/src/assets/themes/office-executive/dusk-executive-suite-v2.png', 'assets/dusk-executive-suite-v2.png'],
      ['src/renderer/src/assets/mascot/pico-office.png', 'assets/pico-office.png']
    ]),
    character('noir-scholar', 'Noir Scholar', 'AGPL-3.0-only', false, [
      variant('noirScholar', 'noir-scholar', 'Noir Study', '#b18a50', 1024, 1536, 'assets/noir-scholar.png', {
        '--market-scene-noir': 'assets/noir-study.png',
        '--market-preview-noir': 'assets/noir-study.png'
      })
    ], [
      ['src/renderer/src/assets/themes/portraits/noir-scholar.png', 'assets/noir-scholar.png'],
      ['src/renderer/src/assets/themes/portraits/noir-study.png', 'assets/noir-study.png'],
      ['src/renderer/src/assets/themes/portraits/noir-study-wide.png', 'assets/noir-study-wide.png']
    ]),
    character('moonlit-maid', 'Moonlit Maid', 'AGPL-3.0-only', false, [
      variant('moonlitMaid', 'moonlit-maid', 'Moonlit Salon', '#806284', 1024, 1536, 'assets/moonlit-maid.png', {
        '--market-scene-moonlit': 'assets/moonlit-tea-room.png',
        '--market-preview-moonlit': 'assets/moonlit-tea-room.png'
      })
    ], [
      ['src/renderer/src/assets/themes/portraits/moonlit-maid.png', 'assets/moonlit-maid.png'],
      ['src/renderer/src/assets/themes/portraits/moonlit-tea-room.png', 'assets/moonlit-tea-room.png']
    ]),
    character('starship', 'Starship Cockpit', 'AGPL-3.0-only', false, [
      variant('starshipCockpit', 'starship-cockpit', 'Starship Cockpit', '#67d8ff', 941, 1672, 'assets/frost-navigator.png', {
        '--market-starship-interior': 'assets/cockpit-interior-foreground.png',
        '--market-preview-starship': 'assets/deep-space.png'
      })
    ], starshipFiles()),
    character('ming-snow', 'Ming Snow Palace', 'AGPL-3.0-only', false, [
      variant('mingSnow', 'ming-snow', 'Ming Snow Palace', '#bd8b52', 1024, 1536, 'assets/snow-maiden.png', {
        '--market-scene-ming-snow': 'assets/snow-palace.png',
        '--market-preview-ming-snow': 'assets/snow-palace.png',
        ...mingFrames
      })
    ], mingFiles(['snow-palace.png', 'snow-maiden.png'])),
    character('ming-moon', 'Ming Moon City', 'AGPL-3.0-only', false, [
      variant('mingMoon', 'ming-moon', 'Ming Moon City', '#b4493f', 1024, 1536, 'assets/moon-maiden.png', {
        '--market-scene-ming-moon': 'assets/moon-city.png',
        '--market-preview-ming-moon': 'assets/moon-city.png',
        ...mingFrames
      })
    ], mingFiles(['moon-city.png', 'moon-maiden.png'])),
    character('zhang-juzheng', 'Zhang Juzheng', 'AGPL-3.0-only', false, [
      variant('zhangJuzhengSnow', 'zhang-juzheng-snow', 'Zhang Juzheng', '#9e1b1b', 1024, 1536, 'assets/zhang-juzheng.png', {
        '--market-scene-zhang': 'assets/snow-red-palace.png',
        '--market-preview-zhang': 'assets/snow-red-palace.png',
        '--market-zhang-titlebar-banner': 'assets/titlebar-snow-banner.png',
        ...mingFrames
      })
    ], zhangFiles())
  ]
}

function variant(id, skinId, name, accent, frameWidth, frameHeight, portraitAsset, cssImages) {
  return {
    id,
    skinId,
    name,
    appearance: id === 'maidWhite' || id === 'moonlitMaid' ? 'light' : 'dark',
    portrait: true,
    accent,
    frameWidth,
    frameHeight,
    portraitAsset,
    startup: false,
    ...(cssImages ? { cssImages } : {})
  }
}

function character(id, name, license, startup, variants, files) {
  const style = id === 'gpt' ? 'Gpt' : id[0].toUpperCase() + id.slice(1)
  const fixed = variants.map((item) => ({ ...item, startup }))
  if (id === 'gemini') fixed[0].id = 'ropeGemini'
  if (id === 'gpt') fixed[0].id = 'ropeGpt'
  if (id === 'glm') fixed[0].id = 'ropeGlm'
  if (id === 'grok') fixed[0].id = 'ropeGrok'
  if (id === 'kimi') fixed[0].id = 'ropeKimi'
  if (id === 'qwen') fixed[0].id = 'ropeQwen'
  return { id, name, license, startup, variants: fixed, files, accentFix: style }
}

function starshipFiles() {
  const names = [
    'cockpit-bottom-left.png', 'cockpit-bottom-right.png', 'cockpit-bottom.png', 'cockpit-console-deck.png',
    'cockpit-frame-alpha.png', 'cockpit-interior-foreground.png', 'cockpit-left.png', 'cockpit-right.png',
    'cockpit-top-left.png', 'cockpit-top-right.png', 'cockpit-top.png', 'deep-space.png', 'distant-planet.png',
    'engine-radar-alpha.png', 'frost-navigator.png', 'radar-base.png', 'scout-ship-alpha.png'
  ]
  return names.map((name) => [`src/renderer/src/assets/themes/starship-cockpit/${name}`, `assets/${name}`])
}

function mingFiles(extra) {
  return [...mingDecor, ...extra].map((name) => [`src/renderer/src/assets/themes/ming-dynasty/${name}`, `assets/${name}`])
}

function zhangFiles() {
  const names = [
    'blank-calligraphy-scroll.png', 'calligraphy-scroll-governance.png', 'calligraphy-scroll-minister.png',
    'calligraphy-scroll-spring.png', 'snow-plum-lantern.png', 'snow-red-palace.png', 'status-scroll-wangwei.png',
    'titlebar-calligraphy-overlay.png', 'titlebar-snow-banner-calligraphy.png', 'titlebar-snow-banner.png',
    'zhang-juzheng.png'
  ]
  return [
    ...names.map((name) => [`src/renderer/src/assets/themes/zhang-juzheng-snow/${name}`, `assets/${name}`]),
    ...mingDecor.map((name) => [`src/renderer/src/assets/themes/ming-dynasty/${name}`, `assets/${name}`])
  ]
}

async function writeTheme(theme) {
  const dir = path.join(out, `theme-${theme.id}`)
  await mkdir(dir, { recursive: true })
  for (const [from, to] of theme.files) await copyAsset(from, path.join(dir, to))
  if (theme.startup) {
    for (const file of startupFiles) {
      await copyAsset(`src/renderer/src/bigfish-startup/assets/${file}`, path.join(dir, 'assets/startup', file))
    }
  }
  const previewSource = path.join(dir, theme.variants[0].portraitAsset)
  try {
    await exec('sips', ['-s', 'format', 'webp', previewSource, '--out', path.join(dir, 'preview.webp')])
  } catch {
    await copyFile(previewSource, path.join(dir, 'preview.webp'))
  }
  const startup = theme.startup
    ? Object.fromEntries(startupFiles.map((file) => [file.replace(/\.[^.]+$/, ''), `assets/startup/${file}`]))
    : undefined
  const manifest = {
    formatVersion: 1,
    id: theme.id,
    name: theme.name,
    version: '1.0.0',
    author: 'wangmiao',
    description: `Official Pi-Harness ${theme.name} theme pack`,
    license: theme.license,
    compatiblePiHarness: '>=2.4.0',
    preview: 'preview.webp',
    variants: theme.variants.map((item) => ({ ...item, startup: theme.startup })),
    ...(startup ? { startup } : {})
  }
  await writeFile(path.join(dir, 'theme-pack.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(path.join(dir, 'package.json'), packageJson(`@pi-harness/theme-${theme.id}`, theme.license, 'theme', theme.name))
  await writeFile(path.join(dir, 'README.md'), `# @pi-harness/theme-${theme.id}\n\nOfficial Pi-Harness theme pack for ${theme.name}.\n\nInstall it from Pi-Harness Market. This directory is an independent npm package.\n\n\`\`\`bash\ncd ${dir}\nnpm publish --access public\n\`\`\`\n`)
  await copyFile(theme.license === 'AGPL-3.0-only' ? path.join(app, 'LICENSE') : path.join(app, 'src/renderer/src/bigfish-startup/LICENSE'), path.join(dir, 'LICENSE'))
  await writeFile(path.join(dir, 'NOTICE'), notice(theme.name, theme.license))
}

async function writePets() {
  const bigfish = path.join(out, 'pet-bigfish')
  await mkdir(bigfish, { recursive: true })
  await cp(path.join(app, 'resources/petpacks/bigfish'), bigfish, { recursive: true })
  for (const file of startupFiles) {
    await copyAsset(`src/renderer/src/bigfish-startup/assets/${file}`, path.join(bigfish, 'assets/startup', file))
  }
  const frame = path.join(app, 'resources/petpacks/bigfish/clips/idle')
  const { readdir } = await import('node:fs/promises')
  const first = (await readdir(frame)).find((name) => name.endsWith('.webp'))
  if (first) await copyFile(path.join(frame, first), path.join(bigfish, 'preview.webp'))
  await writeFile(path.join(bigfish, 'package.json'), packageJson('@pi-harness/pet-bigfish', 'SEE LICENSE IN LICENSE', 'pet', 'BigFish'))
  await writeFile(path.join(bigfish, 'README.md'), petReadme('pet-bigfish', 'BigFish', bigfish))
  const pets = [
    ['jelly', 'tibot-jelly', 'Jelly'],
    ['ghost', 'tibot-ghost', 'Ghost'],
    ['circle', 'tibot-circle', 'Circle'],
    ['rounded', 'tibot-rounded', 'Rounded'],
    ['star', 'tibot-star', 'Star'],
    ['triangle', 'tibot-triangle', 'Triangle']
  ]
  for (const [slug, id, name] of pets) {
    const dir = path.join(out, `pet-${slug}`)
    await mkdir(dir, { recursive: true })
    await cp(path.join(app, 'resources/petpacks', id), dir, { recursive: true })
    await writeFile(path.join(dir, 'preview.webp'), await readFile(path.join(bigfish, 'preview.webp')))
    await writeFile(path.join(dir, 'package.json'), packageJson(`@pi-harness/pet-${slug}`, 'SEE LICENSE IN NOTICE.txt', 'pet', name))
    await writeFile(path.join(dir, 'README.md'), petReadme(`pet-${slug}`, name, dir))
  }
}

function packageJson(name, license, kind, title) {
  return JSON.stringify({
    name,
    version: '1.0.0',
    private: false,
    description: `Official Pi-Harness ${title} ${kind} pack`,
    license,
    author: { name: 'wangmiao', email: 'tuziling84@gmail.com' },
    files: kind === 'theme'
      ? ['theme-pack.json', 'preview.webp', 'assets', 'LICENSE', 'NOTICE', 'README.md']
      : ['pet-pack.json', 'preview.webp', 'clips', 'assets', 'indesktop-motions.json', 'LICENSE', 'NOTICE', 'NOTICE.txt', 'README.md'],
    piHarness: { kind, compatible: '>=2.4.0' },
    publishConfig: { access: 'public' }
  }, null, 2) + '\n'
}

function petReadme(dirName, name, dir) {
  return `# @pi-harness/${dirName}\n\nOfficial Pi-Harness desktop pet pack for ${name}. The pet id inside pet-pack.json is unchanged.\n\n\`\`\`bash\ncd ${dir}\nnpm publish --access public\n\`\`\`\n`
}

function notice(name, license) {
  return `${name}\nPublisher: wangmiao <tuziling84@gmail.com>\nLicense: ${license}\n\nCharacter names and marks belong to their owners. This pack does not grant trademark rights.\nArtwork that came from an upstream project keeps that project's notice in LICENSE.\n`
}

async function copyAsset(from, to) {
  await mkdir(path.dirname(to), { recursive: true })
  await cp(path.join(app, from), to)
}

async function copyTibotFixtures() {
  const pets = ['tibot-jelly', 'tibot-ghost', 'tibot-circle', 'tibot-rounded', 'tibot-star', 'tibot-triangle']
  for (const id of pets) {
    const target = path.join(app, 'src/main/pet/fixtures', id)
    await rm(target, { recursive: true, force: true })
    await cp(path.join(app, 'resources/petpacks', id), target, { recursive: true })
  }
}

async function removeSources() {
  await rm(path.join(app, 'resources/petpacks'), { recursive: true, force: true })
  await rm(path.join(app, 'src/renderer/src/assets/themes'), { recursive: true, force: true })
  await rm(path.join(app, 'src/renderer/src/assets/mascot'), { recursive: true, force: true })
  await rm(path.join(app, 'src/renderer/src/bigfish-startup/assets'), { recursive: true, force: true })
}

async function writeRoots() {
  await writeFile(path.join(out, 'README.md'), `# Pi-Harness official packs\n\nEach directory is an independent npm package. There is no workspace file and packages do not depend on each other.\n\nDo not run npm publish from this folder. Publish one package at a time after confirming the @pi-harness scope.\n`)
  await mkdir(path.join(out, 'docs'), { recursive: true })
  await writeFile(path.join(out, 'docs/PACKAGES.md'), `# Independent packages\n\nTheme packs use theme-pack.json formatVersion 1. Pet packs use the existing pet-pack.json format.\n\nPublish:\n\n\`\`\`bash\nnpm publish --access public\n\`\`\`\n\nRun that inside one package directory. Pi-Harness Market installs from the npm registry. It does not read this folder at runtime.\n`)
}
