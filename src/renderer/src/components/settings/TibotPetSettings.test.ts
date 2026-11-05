import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { defaultDesktopPetSettings } from '@shared/pet/desktop'
import { SETTINGS_DRAFT_KEY } from './draft-key'
import TibotPetSettings from './TibotPetSettings.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

function mountStudio(activePackId: string) {
  const desktopPet = defaultDesktopPetSettings()
  desktopPet.activePackId = activePackId
  const draft = ref({ desktopPet })
  const wrapper = mount(TibotPetSettings, {
    global: {
      provide: { [SETTINGS_DRAFT_KEY as symbol]: draft },
      mocks: { $t: (key: string) => key }
    }
  })
  return { draft, wrapper }
}

it('hides the jelly studio unless a single shape pet is selected', () => {
  const fish = mountStudio('bigfish')
  expect(fish.wrapper.find('[data-testid="tibot-pet-settings"]').exists()).toBe(false)
  fish.wrapper.unmount()
  const group = mountStudio('tibot')
  expect(group.wrapper.find('[data-testid="tibot-pet-settings"]').exists()).toBe(false)
  group.wrapper.unmount()
})

it('writes color and a one-shot performance for the selected shape', async () => {
  const { draft, wrapper } = mountStudio('tibot-star')
  expect(wrapper.text()).not.toContain('settings.tibotFriends')
  const colors = wrapper.findAll('button[aria-label="settings.tibotColor"]')
  await colors[5]!.trigger('click')
  expect(draft.value.desktopPet.tibot.color).toBe('#fa6291')
  const jump = wrapper.findAll('button').find((button) => button.text() === 'settings.tibotActJump')
  await jump!.trigger('click')
  expect(draft.value.desktopPet.tibot.cue?.action).toBe('jump')
  expect(draft.value.desktopPet.tibot.cue?.at).toBeGreaterThan(0)
  wrapper.unmount()
})
