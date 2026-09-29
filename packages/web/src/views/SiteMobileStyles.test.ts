// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

// Vitest executes this source test in Node so the stylesheet can be checked as
// part of the source contract.
import { readFileSync } from 'node:fs'

const mobileStyles = readFileSync('src/styles.css', 'utf8').replaceAll('\r\n', '\n')

describe('mobile site styles', () => {
  it('keeps the site menu sheet scrollable inside a short viewport, header fixed', () => {
    // The menu's rules moved to Navigation.css in issue #209.
    const menuStyles = readFileSync('src/views/Navigation.css', 'utf8').replaceAll('\r\n', '\n')
    expect(menuStyles).toContain('position: fixed')
    expect(menuStyles).toContain('height: 100dvh')
    expect(menuStyles).toContain('overflow-y: auto')
    expect(menuStyles).toContain('.nav-sheet-header')
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
