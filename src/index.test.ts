import { describe, expect, it } from 'vitest'
import { APP_NAME } from './index'

describe('index', () => {
  it('should export APP_NAME', () => {
    expect(APP_NAME).toBe('hackz-megalo-back')
  })
})
