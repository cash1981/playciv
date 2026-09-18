import { describe, expect, it } from 'vitest'

import { formatTimestamp } from './formatTimestamp.js'

describe('formatTimestamp', () => {
  it('uses the local log timestamp format', () => {
    expect(formatTimestamp('2026-09-18T07:08:09')).toBe('18.09.2026 07:08:09')
  })

  it('omits missing and invalid timestamps', () => {
    expect(formatTimestamp(undefined)).toBe('')
    expect(formatTimestamp(null)).toBe('')
    expect(formatTimestamp('not-a-date')).toBe('')
  })
})
