import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { SETTINGS_DRAFT_KEY } from './draft-key'
import { setInstalledThemeAssets } from '@renderer/utils/visual-skin'
import MascotSettingsSection from './MascotSettingsSection.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/stores/settings', () => ({
  useSettingsStore: () => ({
    customSkins: [],
    importCustomSkin: vi.fn(),
    createCustomSkinProject: vi.fn(),
    unlockMascot: vi.fn()
  })
}))

const RouterLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.())
  }
})

function mountSection() {
  const draft = ref({
    mascotUnlocked: true,
    mascotStyle: 'maidWhite' as const,
    customSkinId: null,
    petAnimations: true,
    petStatusText: true,
    petAutoSleep: false,
    petSleepMinutes: 10
  })
  const wrapper = mount(MascotSettingsSection, {
    global: {
      provide: { [SETTINGS_DRAFT_KEY as symbol]: draft },
      mocks: { $t: (key: string) => key },
      stubs: { RouterLink }
    }
  })
  return wrapper
}

afterEach(() => {
  setInstalledThemeAssets(null)
})

describe('MascotSettingsSection', () => {
  it('hides uninstalled theme cards and their switches', () => {
    setInstalledThemeAssets([])
    const wrapper = mountSection()
    expect(wrapper.find('[data-mascot-option="maidWhite"]').exists()).toBe(false)
    expect(wrapper.find('[data-mascot-option="none"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-mascot-option]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="missing-pack-preview"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mascot-theme-controls"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="mascot-missing-theme"]').text()).toContain(
      'settings.marketMissingTheme'
    )
    expect(wrapper.text()).not.toContain('settings.marketMissingPet')
    wrapper.unmount()
  })

  it('shows the installed theme and its switches', () => {
    setInstalledThemeAssets([{ packId: 'maid-white', styles: ['maidWhite'] }])
    const wrapper = mountSection()
    expect(wrapper.find('[data-mascot-option="maidWhite"]').exists()).toBe(true)
    expect(wrapper.find('[data-mascot-option="office"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mascot-theme-controls"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mascot-missing-theme"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
