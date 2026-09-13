import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import SearchField from './SearchField.vue'

const wrappers: VueWrapper[] = []

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
})

describe('SearchField', () => {
  it('keeps the focus ring on the composite field instead of the nested input', () => {
    const wrapper = mount(SearchField, {
      props: {
        modelValue: '',
        placeholder: 'Search'
      }
    })
    wrappers.push(wrapper)

    expect(wrapper.get('label').classes()).toContain('ui-search-field')
    expect(wrapper.get('input').classes()).toContain('ui-search-field__input')
  })
})
