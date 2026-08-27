import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PetStatus from './PetStatus.vue'

describe('PetStatus', () => {
  it('shows the current pet state as bubble copy', async () => {
    const wrapper = mount(PetStatus, { props: { state: 'idle' } })
    expect(wrapper.get('[data-testid="pet-status-bubble"]').text()).toContain('待机')
    expect(wrapper.get('[data-testid="pet-status-bubble"]').attributes('data-tail')).toBe('bottom')

    await wrapper.setProps({ state: 'thinking' })
    expect(wrapper.get('[data-testid="pet-status-bubble"]').text()).toContain('思考中')
  })

  it('points the tail left for the starship navigator bubble', () => {
    const wrapper = mount(PetStatus, { props: { state: 'idle', tail: 'left' } })
    expect(wrapper.get('[data-testid="pet-status-bubble"]').attributes('data-tail')).toBe('left')
  })
})
