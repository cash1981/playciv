// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { HelpHint } from './HelpHint.js'

afterEach(cleanup)

describe('HelpHint', () => {
  it('opens the help in a dialog and returns focus to the question mark', () => {
    render(
      <HelpHint label="Chivalry">
        <p>You need an Incense token.</p>
      </HelpHint>,
    )
    const help = screen.getByRole('button', { name: 'Help: Chivalry' })
    expect(help.getAttribute('title')).toBe('Help: Chivalry')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(help)
    expect(screen.getByRole('dialog', { name: 'Chivalry' })).toBeTruthy()
    expect(screen.getByText('You need an Incense token.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(help)
  })

  it('closes with Escape', () => {
    render(
      <HelpHint label="Chivalry">
        <p>Help text</p>
      </HelpHint>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Help: Chivalry' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
