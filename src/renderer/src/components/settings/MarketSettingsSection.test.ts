import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import type { InstalledMarketPackage } from '@shared/market/types'
import MarketSettingsSection from './MarketSettingsSection.vue'

function pkg(name: string, kind: 'theme' | 'pet', extra: Partial<InstalledMarketPackage> = {}) {
  return {
    name,
    kind,
    version: '1.0.0',
    packId: name.split('/')[1].replace(/^(theme|pet)-/, ''),
    license: 'MIT',
    latest: null,
    updateAvailable: false,
    manifest: null,
    petId: null,
    ...extra
  } satisfies InstalledMarketPackage
}

const installed = {
  themes: [pkg('@piharness/theme-deepseek', 'theme')],
  pets: [
    pkg('@piharness/pet-bigfish', 'pet', { petId: 'bigfish' }),
    pkg('@piharness/pet-bigfish-2', 'pet'),
    pkg('@piharness/pet-bigfish-1', 'pet')
  ]
}

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${Object.values(values).join(',')}` : key,
    locale: { value: 'zh-CN' }
  })
}))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@renderer/composables/useApi', () => ({
  getErrorMessage: (error: unknown) => {
    if (error && typeof error === 'object' && 'userMessage' in error) {
      const text = (error as { userMessage?: unknown }).userMessage
      if (typeof text === 'string' && text.trim()) return text.trim()
    }
    if (error && typeof error === 'object' && 'message' in error) {
      const text = (error as { message?: unknown }).message
      if (typeof text === 'string' && text.trim()) return text.trim()
    }
    return error instanceof Error ? error.message : String(error)
  },
  getApi: () => ({
    on: () => () => undefined,
    market: {
      installed: vi.fn().mockResolvedValue(installed),
      install: vi.fn().mockRejectedValue({
        code: 'APP_ERROR',
        message: 'The pet directory contains too many files',
        userMessage: 'The pet directory contains too many files'
      }),
      search: vi.fn().mockResolvedValue({
        packages: [
          {
            name: '@piharness/theme-deepseek',
            kind: 'theme',
            version: '1.0.2',
            description: '蓝发女仆 / Blue-haired maid',
            author: 'Pi',
            license: 'MIT',
            unpackedSize: 2048,
            deprecated: false,
            compatible: true
          },
          {
            name: '@piharness/pet-bigfish-12',
            kind: 'pet',
            version: '1.0.3',
            description: '大肥鱼动作包 12：给大肥鱼桌宠添加 10 个新动作 / BigFish action pack 12',
            author: 'wangmiao',
            license: 'MIT',
            unpackedSize: 41378912,
            deprecated: false,
            compatible: true
          }
        ],
        incomplete: false,
        fromCache: false,
        offline: false
      })
    }
  })
}))
vi.mock('@renderer/stores/settings', () => ({
  useSettingsStore: () => ({
    settings: {
      mascotStyle: 'deepseekDream',
      customSkinId: null,
      desktopPet: { enabled: true, activePackId: 'bigfish' }
    },
    patch: vi.fn()
  })
}))

function mountSection() {
  return mount(MarketSettingsSection, { global: { mocks: { $t: (key: string) => key } } })
}

describe('MarketSettingsSection', () => {
  it('shows catalog cards with readable names and the localized description', async () => {
    const wrapper = mountSection()
    await flushPromises()
    const card = wrapper.get('[data-market-package="@piharness/theme-deepseek"]')
    expect(card.find('h2').text()).toBe('DeepSeek')
    expect(card.text()).toContain('蓝发女仆')
    expect(card.text()).not.toContain('Blue-haired maid')
    expect(card.text()).toContain('settings.marketKindTheme')
    expect(card.find('[data-testid="market-in-use"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('groups action packs under their pet and marks packs in use', async () => {
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.get('[data-testid="market-tab-installed"]').trigger('click')
    await flushPromises()
    const cards = wrapper.findAll('[data-market-installed]')
    expect(cards.map((card) => card.attributes('data-market-installed'))).toEqual([
      '@piharness/theme-deepseek',
      '@piharness/pet-bigfish'
    ])
    expect(cards.every((card) => card.find('[data-testid="market-in-use"]').exists())).toBe(true)
    const pet = cards[1]
    expect(pet.find('[data-market-action-pack]').exists()).toBe(false)
    await pet.get('[data-testid="market-action-packs-toggle"]').trigger('click')
    expect(pet.findAll('[data-market-action-pack]').map((item) => item.text())).toEqual([
      expect.stringContaining('settings.marketActionPackName:BigFish,1'),
      expect.stringContaining('settings.marketActionPackName:BigFish,2')
    ])
    wrapper.unmount()
  })

  it('shows the install error instead of an object', async () => {
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.get('[data-market-package="@piharness/pet-bigfish-12"] button').trigger('click')
    await flushPromises()
    expect(toast.error).toHaveBeenCalledWith('settings.marketFailed', {
      description: 'The pet directory contains too many files'
    })
    expect(wrapper.text()).toContain('The pet directory contains too many files')
    expect(wrapper.text()).not.toContain('[object Object]')
    wrapper.unmount()
  })
})
