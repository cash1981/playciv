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

  it('trims the board in short landscape viewports above 900px wide', () => {
    expect(mobileStyles).toContain(`@media (max-height: 500px) and (orientation: landscape) {
  .app {
    width: 100%;
    padding: 0.5rem 0.75rem;
  }

  .topbar {
    padding: 0.35rem 0.6rem;
    margin-bottom: 0.5rem;
  }

  .board-scroll {
    max-height: 55vh;
  }
}`)
  })

  it('puts the board palette below the board at every width, with no side by side rule left (#260)', () => {
    expect(mobileStyles).toMatch(/\.board-layout \{\n  display: flex;\n  flex-direction: column;/)
    // The palette has no width of its own, so it is as wide as the board
    expect(mobileStyles).not.toContain('.board-palette')
    // One column everywhere: no media query switches the direction again
    expect(mobileStyles.match(/\.board-layout/g)).toHaveLength(1)
  })

  it('keeps the global spinner fixed, click-through and larger on touch screens (issue #225)', () => {
    const spinner = readFileSync('src/views/GlobalSpinner.css', 'utf8').replaceAll('\r\n', '\n')
    expect(spinner).toContain('position: fixed')
    expect(spinner).toContain('pointer-events: none')
    expect(spinner).toContain('@media (pointer: coarse)')
    expect(spinner).toContain('--spinner-size: 56px')
    expect(spinner).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
