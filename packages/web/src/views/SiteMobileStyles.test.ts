// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

// Vitest executes this source test in Node so the stylesheet can be checked as
// part of the source contract.
import { readFileSync } from 'node:fs'

const mobileStyles = readFileSync('src/styles.css', 'utf8').replaceAll('\r\n', '\n')

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

  it('stacks and fills the board in short landscape viewports above 900px wide', () => {
    expect(mobileStyles).toContain(`@media (max-height: 500px) and (orientation: landscape) {
  .app {
    width: 100%;
    padding: 0.5rem 0.75rem;
  }

  .topbar {
    padding: 0.35rem 0.6rem;
    margin-bottom: 0.5rem;
  }

  .board-layout {
    flex-direction: column;
  }

  .board-scroll {
    width: 100%;
    max-height: 55vh;
  }

  .board-palette {
    width: 100%;
  }
}`)
  })
})
