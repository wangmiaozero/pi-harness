import { describe, expect, it } from 'vitest'
import { pickNewestModel } from './latest-models'

describe('pickNewestModel', () => {
  it('keeps the most recently added model, and always returns one when any exist', () => {
    expect(
      pickNewestModel([
        { id: 'b', createdAt: 2, updatedAt: 9 },
        { id: 'a', createdAt: 5, updatedAt: 1 },
        { id: 'c', createdAt: 5, updatedAt: 3 }
      ])
    ).toMatchObject({ id: 'c' })
    expect(pickNewestModel([])).toBeUndefined()
  })
})