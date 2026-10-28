/**
 * Desktop pet context menu — a lightweight DOM menu (no framework dep in
 * the pet window). Every item maps to a PetMenuAction handled in the main
 * process; nothing here mutates settings directly.
 */

import type { PetMenuAction } from '@shared/ipc/api-types'
import type { AppLanguage, AppLocale } from '@shared/constants/language'
import { resolveAppLocale } from '@shared/constants/language'

interface MenuLabel {
  openMain: string
  openSettings: string
  alwaysOnTop: string
  alwaysOnTopOff: string
  reducedMotion: string
  reducedMotionOff: string
  resetPosition: string
  hide: string
  quit: string
}

const MENU_LABELS: Record<AppLocale, MenuLabel> = {
  'en-US': {
    openMain: 'Open Pi-Harness',
    openSettings: 'Settings…',
    alwaysOnTop: 'Keep on top ✓',
    alwaysOnTopOff: 'Keep on top',
    reducedMotion: 'Reduced motion ✓',
    reducedMotionOff: 'Reduced motion',
    resetPosition: 'Reset position',
    hide: 'Hide pet',
    quit: 'Quit Pi-Harness'
  },
  'zh-CN': {
    openMain: '打开 Pi-Harness',
    openSettings: '设置…',
    alwaysOnTop: '置顶显示 ✓',
    alwaysOnTopOff: '置顶显示',
    reducedMotion: '减少动效 ✓',
    reducedMotionOff: '减少动效',
    resetPosition: '重置位置',
    hide: '隐藏宠物',
    quit: '退出 Pi-Harness'
  },
  'zh-TW': {
    openMain: '開啟 Pi-Harness',
    openSettings: '設定…',
    alwaysOnTop: '釘選顯示 ✓',
    alwaysOnTopOff: '釘選顯示',
    reducedMotion: '減少動態 ✓',
    reducedMotionOff: '減少動態',
    resetPosition: '重設位置',
    hide: '隱藏寵物',
    quit: '結束 Pi-Harness'
  },
  'ja-JP': {
    openMain: 'Pi-Harness を開く',
    openSettings: '設定…',
    alwaysOnTop: '常に手前に表示 ✓',
    alwaysOnTopOff: '常に手前に表示',
    reducedMotion: '視覚効果を減らす ✓',
    reducedMotionOff: '視覚効果を減らす',
    resetPosition: '位置をリセット',
    hide: 'ペットを隠す',
    quit: 'Pi-Harness を終了'
  },
  'ko-KR': {
    openMain: 'Pi-Harness 열기',
    openSettings: '설정…',
    alwaysOnTop: '항상 위에 표시 ✓',
    alwaysOnTopOff: '항상 위에 표시',
    reducedMotion: '움직임 줄이기 ✓',
    reducedMotionOff: '움직임 줄이기',
    resetPosition: '위치 초기화',
    hide: '펫 숨기기',
    quit: 'Pi-Harness 종료'
  },
  'ru-RU': {
    openMain: 'Открыть Pi-Harness',
    openSettings: 'Настройки…',
    alwaysOnTop: 'Поверх окон ✓',
    alwaysOnTopOff: 'Поверх окон',
    reducedMotion: 'Меньше анимации ✓',
    reducedMotionOff: 'Меньше анимации',
    resetPosition: 'Сбросить позицию',
    hide: 'Скрыть питомца',
    quit: 'Выйти из Pi-Harness'
  },
  'fr-FR': {
    openMain: 'Ouvrir Pi-Harness',
    openSettings: 'Réglages…',
    alwaysOnTop: 'Toujours au premier plan ✓',
    alwaysOnTopOff: 'Toujours au premier plan',
    reducedMotion: 'Réduire les animations ✓',
    reducedMotionOff: 'Réduire les animations',
    resetPosition: 'Réinitialiser la position',
    hide: 'Masquer la mascotte',
    quit: 'Quitter Pi-Harness'
  },
  'de-DE': {
    openMain: 'Pi-Harness öffnen',
    openSettings: 'Einstellungen…',
    alwaysOnTop: 'Immer im Vordergrund ✓',
    alwaysOnTopOff: 'Immer im Vordergrund',
    reducedMotion: 'Bewegung reduzieren ✓',
    reducedMotionOff: 'Bewegung reduzieren',
    resetPosition: 'Position zurücksetzen',
    hide: 'Haustier ausblenden',
    quit: 'Pi-Harness beenden'
  }
}

export function menuLabels(language: AppLanguage): MenuLabel {
  return MENU_LABELS[resolveAppLocale(language, navigator.language)]
}

const ACTION_MENU_COPY: Record<AppLocale, { play: string; back: string; search: string }> = {
  'zh-CN': { play: '播放动作', back: '返回', search: '搜索动作…' },
  'zh-TW': { play: '播放動作', back: '返回', search: '搜尋動作…' },
  'en-US': { play: 'Play action', back: 'Back', search: 'Search actions…' },
  'ja-JP': { play: 'アクションを再生', back: '戻る', search: 'アクションを検索…' },
  'ko-KR': { play: '동작 재생', back: '뒤로', search: '동작 검색…' },
  'ru-RU': { play: 'Выбрать действие', back: 'Назад', search: 'Поиск действий…' },
  'fr-FR': { play: 'Jouer une action', back: 'Retour', search: 'Rechercher une action…' },
  'de-DE': { play: 'Aktion abspielen', back: 'Zurück', search: 'Aktionen suchen…' }
}

export interface PetMenuOptions {
  language: AppLanguage
  actions?: Array<{ clip: string; label: string }>
  onPlayAction?: (clip: string) => void
  alwaysOnTop: boolean
  reducedMotion: boolean
  onAction: (action: PetMenuAction) => void
}

export function showPetMenu(options: PetMenuOptions): void {
  dismissPetMenu()
  const labels = menuLabels(options.language)
  const items: Array<{ action: PetMenuAction | null; label: string }> = [
    { action: 'open-main', label: labels.openMain },
    { action: 'open-settings', label: labels.openSettings },
    { action: null, label: '—' },
    {
      action: 'toggle-always-on-top',
      label: options.alwaysOnTop ? labels.alwaysOnTop : labels.alwaysOnTopOff
    },
    {
      action: 'toggle-reduced-motion',
      label: options.reducedMotion ? labels.reducedMotion : labels.reducedMotionOff
    },
    { action: 'reset-position', label: labels.resetPosition },
    { action: null, label: '—' },
    { action: 'hide', label: labels.hide },
    { action: 'quit', label: labels.quit }
  ]

  const menu = document.createElement('div')
  menu.id = 'pet-context-menu'
  menu.setAttribute('role', 'menu')
  menu.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'min-width:180px',
    'max-height:calc(100vh - 8px)',
    'overflow-y:auto',
    'box-sizing:border-box',
    'padding:4px',
    'border-radius:10px',
    'background:rgba(28,28,30,0.94)',
    'border:1px solid rgba(255,255,255,0.14)',
    'box-shadow:0 8px 28px rgba(0,0,0,0.4)',
    'color:#f2f2f7',
    'font:13px -apple-system,"Segoe UI",sans-serif',
    'user-select:none'
  ].join(';')

  for (const item of items) {
    if (item.action === null) {
      const divider = document.createElement('div')
      divider.style.cssText = 'height:1px;margin:4px 8px;background:rgba(255,255,255,0.12)'
      menu.appendChild(divider)
      continue
    }
    const row = document.createElement('div')
    row.textContent = item.label
    row.setAttribute('role', 'menuitem')
    row.style.cssText =
      'padding:6px 12px;border-radius:6px;cursor:default;white-space:nowrap;transition:background 0.12s'
    row.addEventListener('mouseenter', () => {
      row.style.background = 'rgba(255,255,255,0.12)'
    })
    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent'
    })
    const action = item.action
    row.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      event.stopPropagation()
      event.preventDefault()
      dismissPetMenu()
      options.onAction(action)
    })
    menu.appendChild(row)
  }

  if (options.actions?.length && options.onPlayAction) {
    const copy = ACTION_MENU_COPY[resolveAppLocale(options.language, navigator.language)]
    const play = document.createElement('button')
    play.type = 'button'
    play.setAttribute('role', 'menuitem')
    play.textContent = `${copy.play} (${options.actions.length}) ▸`
    play.style.cssText =
      'display:block;width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left;padding:6px 12px;cursor:pointer'
    play.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      event.stopPropagation()
      event.preventDefault()
      menu.replaceChildren()
      const back = document.createElement('button')
      back.type = 'button'
      back.textContent = `‹ ${copy.back}`
      back.style.cssText = play.style.cssText
      back.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        showPetMenu(options)
      })
      menu.appendChild(back)
      const search = document.createElement('input')
      search.type = 'search'
      search.placeholder = copy.search
      search.setAttribute('aria-label', copy.search)
      search.style.cssText =
        'box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #777;border-radius:6px;background:#252527;color:inherit;font:inherit'
      search.addEventListener('mousedown', (event) => event.stopPropagation())
      menu.appendChild(search)
      const list = document.createElement('div')
      menu.appendChild(list)
      const renderActions = () => {
        list.replaceChildren()
        const query = search.value.trim().toLocaleLowerCase()
        for (const item of options.actions ?? []) {
          if (query && !`${item.label} ${item.clip}`.toLocaleLowerCase().includes(query)) continue
          const row = document.createElement('button')
          row.type = 'button'
          row.setAttribute('role', 'menuitem')
          row.dataset.clip = item.clip
          row.textContent = item.label
          row.style.cssText = play.style.cssText
          row.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return
            event.stopPropagation()
            dismissPetMenu()
            options.onPlayAction?.(item.clip)
          })
          list.appendChild(row)
        }
      }
      search.addEventListener('input', renderActions)
      renderActions()
    })
    menu.insertBefore(play, menu.children[2] ?? null)
  }

  document.body.appendChild(menu)
  // Keep the menu fully inside the window (the window itself is clamped by main).
  const rect = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(4, Math.min(window.innerWidth - rect.width - 4, rect.left))}px`
  menu.style.top = `${Math.max(4, Math.min(window.innerHeight - rect.height - 4, rect.top))}px`

  window.addEventListener('mousedown', dismissPetMenu, { once: true })
  window.addEventListener('blur', dismissPetMenu, { once: true })
}

export function dismissPetMenu(): void {
  document.getElementById('pet-context-menu')?.remove()
}
