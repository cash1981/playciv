// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

// Vitest executes this source test in Node so the stylesheet can be checked as
// part of the source contract.
import { readFileSync } from 'node:fs'

const mobileStyles = readFileSync('src/styles.css', 'utf8')

describe('mobile site styles', () => {
  it('keeps the help menu scrollable within a short viewport', () => {
    expect(mobileStyles).toContain('max-height: calc(100dvh - 1.5rem)')
    expect(mobileStyles).toContain('overflow-y: auto')
    expect(mobileStyles).toContain('bottom: 0.75rem')
    expect(mobileStyles).toContain('z-index: 11')
  })

  it('keeps tablet controls and nested account fields touch-sized', () => {
    expect(mobileStyles).toContain('@media (max-width: 900px)')
    expect(mobileStyles).toContain('.center form label > input')
    expect(mobileStyles).toContain('.game-list button.small')
    expect(mobileStyles).toContain('min-height: 2.75rem')
  })
})
