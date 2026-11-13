// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { DISPLAY_SETTINGS_KEY } from '../lib/displaySettings.js'
import { DisplaySettings, useDisplaySettings } from './DisplaySettings.js'

function Harness({ autoZoom = 0.65 }: { readonly autoZoom?: number }): React.JSX.Element {
  const { settings, setSettings, reset } = useDisplaySettings()
  return (
    <>
      <p data-testid="settings">{JSON.stringify(settings)}</p>
      <DisplaySettings settings={settings} autoZoom={autoZoom} onChange={setSettings} onReset={reset} />
    </>
  )
}

const stored = (): unknown => JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_KEY) ?? 'null')
const shown = (): unknown => JSON.parse(screen.getByTestId('settings').textContent ?? 'null')
const openPanel = (): HTMLElement => {
  fireEvent.click(screen.getByRole('button', { name: 'Display settings' }))
  return screen.getByRole('dialog', { name: 'Display settings' })
}

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', () => ({ matches }))
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DisplaySettings', () => {
  it('is closed until the gear is pressed, and the gear says what it opens', () => {
    render(<Harness />)
    const gear = screen.getByRole('button', { name: 'Display settings' })
    expect(gear.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(gear)
    expect(gear.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('dialog', { name: 'Display settings' }).getAttribute('aria-modal')).toBe('true')
  })

  it('offers three range sliders with labels, ranges and live readouts', () => {
    render(<Harness />)
    const dialog = within(openPanel())
    const zoom = dialog.getByLabelText('Map zoom') as HTMLInputElement
    const icons = dialog.getByLabelText('Status icon size') as HTMLInputElement
    const width = dialog.getByLabelText('Status panel width') as HTMLInputElement
    for (const slider of [zoom, icons, width]) expect(slider.type).toBe('range')
    expect([zoom.min, zoom.max, zoom.step]).toEqual(['0.25', '1.5', '0.05'])
    expect([icons.min, icons.max, icons.step]).toEqual(['0.7', '1.5', '0.05'])
    expect([width.min, width.max, width.step]).toEqual(['14', '24', '0.5'])
    expect(zoom.getAttribute('aria-valuetext')).toBe('65 %')
    expect(icons.getAttribute('aria-valuetext')).toBe('100 %')
    expect(width.getAttribute('aria-valuetext')).toBe('16.5 rem')

    fireEvent.change(icons, { target: { value: '1.3' } })
    fireEvent.change(width, { target: { value: '21' } })
    expect(dialog.getByText('130 %')).toBeTruthy()
    expect(dialog.getByText('21 rem')).toBeTruthy()
  })

  it('the sliders change the settings and save them', () => {
    render(<Harness />)
    const dialog = within(openPanel())
    fireEvent.click(dialog.getByRole('switch', { name: 'Auto' }))
    fireEvent.change(dialog.getByLabelText('Map zoom'), { target: { value: '0.8' } })
    fireEvent.change(dialog.getByLabelText('Status icon size'), { target: { value: '1.2' } })
    fireEvent.change(dialog.getByLabelText('Status panel width'), { target: { value: '19.5' } })
    const expected = { mapZoom: 0.8, iconScale: 1.2, sidebarWidth: 19.5, showLabels: false }
    expect(shown()).toEqual(expected)
    expect(stored()).toEqual(expected)
  })

  it('reads what an earlier visit saved', () => {
    localStorage.setItem(DISPLAY_SETTINGS_KEY, '{"mapZoom":0.5,"iconScale":1.4,"sidebarWidth":22,"showLabels":true}')
    render(<Harness />)
    expect(shown()).toEqual({ mapZoom: 0.5, iconScale: 1.4, sidebarWidth: 22, showLabels: true })
    const dialog = within(openPanel())
    expect((dialog.getByLabelText('Status icon size') as HTMLInputElement).value).toBe('1.4')
    expect((dialog.getByRole('switch', { name: 'Show labels' }) as HTMLInputElement).checked).toBe(true)
    expect((dialog.getByRole('switch', { name: 'Auto' }) as HTMLInputElement).checked).toBe(false)
  })

  it('Auto disables the zoom slider and shows the fitted zoom; turning it off keeps that zoom', () => {
    render(<Harness autoZoom={0.65} />)
    const dialog = within(openPanel())
    const zoom = dialog.getByLabelText('Map zoom') as HTMLInputElement
    const auto = dialog.getByRole('switch', { name: 'Auto' }) as HTMLInputElement
    expect(auto.checked).toBe(true)
    expect(zoom.disabled).toBe(true)
    expect(zoom.value).toBe('0.65')

    fireEvent.click(auto)
    expect(zoom.disabled).toBe(false)
    expect(shown()).toMatchObject({ mapZoom: 0.65 })

    fireEvent.change(zoom, { target: { value: '1.1' } })
    fireEvent.click(auto)
    expect(zoom.disabled).toBe(true)
    expect(shown()).toMatchObject({ mapZoom: 'auto' })
  })

  it('Reset to defaults restores every setting and the saved copy', () => {
    localStorage.setItem(DISPLAY_SETTINGS_KEY, '{"mapZoom":0.5,"iconScale":1.4,"sidebarWidth":22,"showLabels":true}')
    render(<Harness />)
    const dialog = within(openPanel())
    fireEvent.click(dialog.getByRole('button', { name: 'Reset to defaults' }))
    const defaults = { mapZoom: 'auto', iconScale: 1, sidebarWidth: 16.5, showLabels: false }
    expect(shown()).toEqual(defaults)
    expect(stored()).toEqual(defaults)
    expect((dialog.getByRole('switch', { name: 'Auto' }) as HTMLInputElement).checked).toBe(true)
    expect((dialog.getByRole('switch', { name: 'Show labels' }) as HTMLInputElement).checked).toBe(false)
  })

  it('Show labels is a switch that is off by default, has a help sentence, toggles and saves', () => {
    render(<Harness />)
    const dialog = within(openPanel())
    const labels = dialog.getByRole('switch', { name: 'Show labels' }) as HTMLInputElement
    expect(labels.checked).toBe(false)
    expect(labels.getAttribute('aria-describedby')).toBe(
      dialog.getByText('Name every status value above its icon instead of waiting for a tooltip').id,
    )

    fireEvent.click(labels)
    expect(labels.checked).toBe(true)
    expect(shown()).toMatchObject({ showLabels: true })
    expect(stored()).toMatchObject({ showLabels: true })

    fireEvent.click(labels)
    expect(labels.checked).toBe(false)
    expect(stored()).toMatchObject({ showLabels: false })
  })

  it('Show labels keeps the other settings, and they keep it', () => {
    render(<Harness />)
    const dialog = within(openPanel())
    fireEvent.click(dialog.getByRole('switch', { name: 'Show labels' }))
    fireEvent.change(dialog.getByLabelText('Status icon size'), { target: { value: '1.3' } })
    expect(shown()).toMatchObject({ mapZoom: 'auto', iconScale: 1.3, sidebarWidth: 16.5, showLabels: true })
  })

  it('Escape closes the panel and returns focus to the gear', () => {
    render(<Harness />)
    const gear = screen.getByRole('button', { name: 'Display settings' })
    gear.focus()
    const dialog = openPanel()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBe(document.activeElement)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(gear)
  })

  it('the Close button closes the panel and returns focus to the gear', () => {
    render(<Harness />)
    const dialog = openPanel()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Display settings' }))
  })

  it('a tap outside closes it on the click, a tap inside does not', () => {
    render(<Harness />)
    const dialog = openPanel()
    const backdrop = dialog.parentElement as HTMLElement
    const slider = within(dialog).getByLabelText('Status icon size')
    fireEvent.pointerDown(slider)
    fireEvent.click(slider)
    fireEvent.pointerDown(dialog)
    fireEvent.click(dialog)
    expect(screen.queryByRole('dialog')).not.toBeNull()
    // Nothing happens on the press itself, so the tap cannot also act on what is underneath.
    fireEvent.pointerDown(backdrop)
    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.click(backdrop)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Display settings' }))
  })

  it('a slider drag that ends over the backdrop does not close it', () => {
    render(<Harness />)
    const dialog = openPanel()
    // The click after such a drag is dispatched to the common ancestor: the backdrop.
    fireEvent.pointerDown(within(dialog).getByLabelText('Status icon size'))
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeNull()
    // And a stray click that was not preceded by a press on the backdrop closes nothing.
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('Escape works when focus has fallen to the page body, and returns focus to the gear', () => {
    render(<Harness />)
    openPanel()
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Display settings' }))
  })

  it('stops listening for keys once it is closed', () => {
    render(<Harness />)
    const dialog = openPanel()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('a click on text in the sheet keeps focus inside the dialog', () => {
    render(<Harness />)
    const dialog = openPanel()
    expect(dialog.tabIndex).toBe(-1)
    dialog.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('keeps Tab inside the panel, wrapping from the last control to the first and back', () => {
    render(<Harness />)
    const dialog = within(openPanel())
    const close = dialog.getByRole('button', { name: 'Close' })
    const reset = dialog.getByRole('button', { name: 'Reset to defaults' })
    reset.focus()
    fireEvent.keyDown(reset, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(reset)
  })

  it('Tab and Shift+Tab with focus on the sheet itself stay inside the panel', () => {
    render(<Harness />)
    const dialog = openPanel()
    const inDialog = within(dialog)
    dialog.focus()
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(inDialog.getByRole('button', { name: 'Reset to defaults' }))
    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(inDialog.getByRole('button', { name: 'Close' }))
  })

  it('Tab from the page body lands inside the sheet', () => {
    render(<Harness />)
    const dialog = within(openPanel())
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Close' }))
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Reset to defaults' }))
  })

  it('arrow keys on a slider do not reach the board', () => {
    const onDocumentKey = vi.fn()
    document.addEventListener('keydown', onDocumentKey)
    try {
      render(<Harness />)
      const slider = within(openPanel()).getByLabelText('Status icon size')
      fireEvent.keyDown(slider, { key: 'ArrowRight' })
      expect(onDocumentKey).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', onDocumentKey)
    }
  })

  it('arrow keys with focus on the page body do not reach the board either', () => {
    const onDocumentKey = vi.fn()
    document.addEventListener('keydown', onDocumentKey)
    try {
      render(<Harness />)
      openPanel()
      ;(document.activeElement as HTMLElement).blur()
      fireEvent.keyDown(document, { key: 'ArrowLeft' })
      expect(onDocumentKey).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', onDocumentKey)
    }
  })

  it('leaves the width slider usable on a wide screen', () => {
    stubMatchMedia(false)
    render(<Harness />)
    const dialog = within(openPanel())
    expect((dialog.getByLabelText('Status panel width') as HTMLInputElement).disabled).toBe(false)
    expect(dialog.queryByText(/fills the width/)).toBeNull()
  })

  it('disables the width slider with a note where the sidebar is stacked and full width', () => {
    stubMatchMedia(true)
    render(<Harness />)
    const dialog = within(openPanel())
    const width = dialog.getByLabelText('Status panel width') as HTMLInputElement
    expect(width.disabled).toBe(true)
    expect(width.getAttribute('aria-describedby')).toBe(dialog.getByText(/fills the width/).id)
  })

  it('follows the viewport while the panel is open', () => {
    stubMatchMedia(false)
    render(<Harness />)
    const width = within(openPanel()).getByLabelText('Status panel width') as HTMLInputElement
    expect(width.disabled).toBe(false)
    stubMatchMedia(true)
    fireEvent(window, new Event('resize'))
    expect(width.disabled).toBe(true)
  })

  it('works with storage blocked: the sliders still change the settings', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    render(<Harness />)
    fireEvent.change(within(openPanel()).getByLabelText('Status icon size'), { target: { value: '1.5' } })
    expect(shown()).toMatchObject({ iconScale: 1.5 })
  })
})
