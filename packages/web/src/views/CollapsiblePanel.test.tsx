// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CollapsiblePanel } from './CollapsiblePanel.js'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('CollapsiblePanel', () => {
  it('starts closed by default and remembers a later open and close', () => {
    const panel = () => <CollapsiblePanel id="test-panel" title="Test panel">Contents</CollapsiblePanel>
    const first = render(panel())
    expect(screen.getByRole('button', { name: 'Test panel' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Test panel' }))
    expect(localStorage.getItem('civ.panel.test-panel')).toBe('true')
    first.unmount()

    const second = render(panel())
    expect(screen.getByRole('button', { name: 'Test panel' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Test panel' }))
    expect(localStorage.getItem('civ.panel.test-panel')).toBe('false')
    second.unmount()

    render(panel())
    expect(screen.getByRole('button', { name: 'Test panel' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('honours an existing stored choice ahead of the default', () => {
    localStorage.setItem('civ.panel.log', 'false')
    render(<CollapsiblePanel id="log" title="Log" defaultOpen>Contents</CollapsiblePanel>)
    expect(screen.getByRole('button', { name: 'Log' }).getAttribute('aria-expanded')).toBe('false')
    expect(localStorage.getItem('civ.panel.log')).toBe('false')
  })

  it('uses an explicit open default for the selected game sections', () => {
    render(<CollapsiblePanel id="draw" title="Draw" defaultOpen>Contents</CollapsiblePanel>)
    expect(screen.getByRole('button', { name: 'Draw' }).getAttribute('aria-expanded')).toBe('true')
  })
})
