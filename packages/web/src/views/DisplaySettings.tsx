/**
 * The Display settings panel of the board (issue #342): sliders for the map zoom
 * (with an Auto switch), the status icon size, the status panel width and a switch
 * that names every status value above its icon.
 *
 * A gear button in the Board header opens it. It is a dialog (a bottom sheet on a
 * phone) that closes with Escape, its Close button or a tap outside it, and hands
 * focus back to the gear. The backdrop is only lightly dimmed so the map and the
 * sidebar stay visible as the sliders move. Settings are per browser; see
 * `lib/displaySettings.ts`.
 */

import { useEffect, useId, useRef, useState } from 'react'

import {
  DEFAULT_DISPLAY_SETTINGS,
  ICON_SCALE_RANGE,
  MAP_ZOOM_RANGE,
  SIDEBAR_WIDTH_RANGE,
  clampToRange,
  loadDisplaySettings,
  saveDisplaySettings,
} from '../lib/displaySettings.js'
import type { DisplaySettings as Settings, SettingRange } from '../lib/displaySettings.js'
import './DisplaySettings.css'

/** The width at which the status sidebar is stacked under the map (see `.board-main` in styles.css). */
const STACKED_QUERY = '(max-width: 900px)'

/** The settings of this browser, saved whenever they change. */
export function useDisplaySettings(): {
  readonly settings: Settings
  readonly setSettings: (next: Settings) => void
  readonly reset: () => void
} {
  const [settings, setSettings] = useState<Settings>(loadDisplaySettings)
  useEffect(() => saveDisplaySettings(settings), [settings])
  return { settings, setSettings, reset: () => setSettings(DEFAULT_DISPLAY_SETTINGS) }
}

/** True while the viewport is narrow enough for the stacked layout. */
function useStackedLayout(): boolean {
  const read = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(STACKED_QUERY).matches
  const [stacked, setStacked] = useState<boolean>(read)
  // A resize (or a rotation) is when the query can change; this also works where a
  // MediaQueryList cannot be listened to.
  useEffect(() => {
    const update = () => setStacked(read())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return stacked
}

export const formatZoom = (zoom: number): string => `${Math.round(zoom * 100)} %`
const formatScale = (scale: number): string => `${Math.round(scale * 100)} %`
const formatWidth = (rem: number): string => `${rem} rem`

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function SliderRow({
  id,
  label,
  range,
  value,
  display,
  disabled = false,
  note,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly range: SettingRange
  readonly value: number
  readonly display: string
  readonly disabled?: boolean
  readonly note?: string
  readonly onChange: (value: number) => void
}): React.JSX.Element {
  const noteId = `${id}-note`
  return (
    <div className="ds-row">
      <div className="ds-row-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{display}</output>
      </div>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        disabled={disabled}
        aria-valuetext={display}
        aria-describedby={note === undefined ? undefined : noteId}
        onChange={(event) => onChange(clampToRange(Number(event.target.value), range))}
      />
      {note !== undefined && (
        <p id={noteId} className="ds-note">
          {note}
        </p>
      )}
    </div>
  )
}

function GearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        d="M10.3 2.6h3.4l.5 2.5 1.7.7 2.1-1.4 2.4 2.4-1.4 2.1.7 1.7 2.5.5v3.4l-2.5.5-.7 1.7 1.4 2.1-2.4 2.4-2.1-1.4-1.7.7-.5 2.5h-3.4l-.5-2.5-1.7-.7-2.1 1.4-2.4-2.4 1.4-2.1-.7-1.7-2.5-.5v-3.4l2.5-.5.7-1.7-1.4-2.1 2.4-2.4 2.1 1.4 1.7-.7z"
      />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

interface Props {
  readonly settings: Settings
  /** The zoom the board currently fits to; shown by the zoom slider while Auto is on. */
  readonly autoZoom: number
  readonly onChange: (next: Settings) => void
  readonly onReset: () => void
}

export function DisplaySettings({ settings, autoZoom, onChange, onReset }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const gearRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  /** True when the current press began on the backdrop itself, so the click that follows is an outside tap. */
  const pressedBackdropRef = useRef(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const stacked = useStackedLayout()
  const titleId = useId()
  const idPrefix = useId()

  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true })
  }, [open])

  function close(): void {
    setOpen(false)
    gearRef.current?.focus({ preventScroll: true })
  }

  // Escape and the Tab trap work wherever focus is: a click on text or padding, or on a
  // control in a browser that does not focus it, leaves focus on <body>. A capture listener
  // on the document runs before the board's own Escape and arrow handlers.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      const sheet = sheetRef.current
      if (sheet === null) return
      const inside = sheet.contains(document.activeElement)
      if (event.key === 'Escape') {
        // Marked as handled so that the board's Escape (cancel a build pick) does not also fire.
        event.preventDefault()
        close()
        return
      }
      // The board nudges the selected piece with the arrows. Inside the sheet they belong to
      // the sliders (see `onSheetKeyDown`); with focus elsewhere nothing here wants them.
      if (event.key.startsWith('Arrow') && !inside) event.stopPropagation()
      if (event.key !== 'Tab') return
      const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (first === undefined || last === undefined) return
      // Focus on the sheet itself (a click on its text or padding) is in none of the tab
      // positions, so it is treated like focus outside: Tab goes to the first control and
      // Shift+Tab to the last, instead of leaving the dialog for the gear behind it.
      if (!inside || document.activeElement === sheet) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus({ preventScroll: true })
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  function onSheetKeyDown(event: React.KeyboardEvent): void {
    // Stopped at the sheet, after the slider has seen it, so the board does not nudge a piece.
    if (event.key.startsWith('Arrow')) event.stopPropagation()
  }

  const auto = settings.mapZoom === 'auto'
  const zoomValue = clampToRange(settings.mapZoom === 'auto' ? autoZoom : settings.mapZoom, MAP_ZOOM_RANGE)

  return (
    <>
      <button
        ref={gearRef}
        type="button"
        className="small ds-gear"
        aria-label="Display settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Display settings"
        onClick={() => setOpen(true)}
      >
        <GearIcon />
      </button>
      {open && (
        // Closes on the click that ends a press which began on the backdrop: a slider drag that
        // ends over the backdrop must not close the sheet, and closing on pointer down would let
        // the same tap reach whatever sits under the finger.
        <div
          className="ds-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            pressedBackdropRef.current = event.target === event.currentTarget
          }}
          onClick={(event) => {
            const outsideTap = pressedBackdropRef.current && event.target === event.currentTarget
            pressedBackdropRef.current = false
            if (outsideTap) close()
          }}
        >
          <section
            ref={sheetRef}
            className="ds-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            // Focusable, so a click on text or padding keeps focus inside the dialog.
            tabIndex={-1}
            onKeyDown={onSheetKeyDown}
          >
            <div className="ds-heading">
              <h2 id={titleId}>Display settings</h2>
              <button ref={closeRef} type="button" onClick={close}>
                Close
              </button>
            </div>
            <p className="ds-note">Saved in this browser only.</p>

            <SliderRow
              id={`${idPrefix}-zoom`}
              label="Map zoom"
              range={MAP_ZOOM_RANGE}
              value={zoomValue}
              display={formatZoom(zoomValue)}
              disabled={auto}
              onChange={(mapZoom) => onChange({ ...settings, mapZoom })}
            />
            <div className="ds-switch-row">
              <label className="ds-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={auto}
                  aria-describedby={`${idPrefix}-auto-note`}
                  onChange={(event) =>
                    onChange({ ...settings, mapZoom: event.target.checked ? 'auto' : clampToRange(autoZoom, MAP_ZOOM_RANGE) })
                  }
                />
                <span>Auto</span>
              </label>
              <span id={`${idPrefix}-auto-note`} className="ds-note">
                Fit the map to the width it gets
              </span>
            </div>

            <SliderRow
              id={`${idPrefix}-icons`}
              label="Status icon size"
              range={ICON_SCALE_RANGE}
              value={settings.iconScale}
              display={formatScale(settings.iconScale)}
              onChange={(iconScale) => onChange({ ...settings, iconScale })}
            />
            <div className="ds-switch-row">
              <label className="ds-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.showLabels}
                  aria-describedby={`${idPrefix}-labels-note`}
                  onChange={(event) => onChange({ ...settings, showLabels: event.target.checked })}
                />
                <span>Show labels</span>
              </label>
              <span id={`${idPrefix}-labels-note`} className="ds-note">
                Name every status value above its icon instead of waiting for a tooltip
              </span>
            </div>
            <SliderRow
              id={`${idPrefix}-width`}
              label="Status panel width"
              range={SIDEBAR_WIDTH_RANGE}
              value={settings.sidebarWidth}
              display={formatWidth(settings.sidebarWidth)}
              disabled={stacked}
              {...(stacked ? { note: 'On narrow screens the status panel fills the width, so this has no effect.' } : {})}
              onChange={(sidebarWidth) => onChange({ ...settings, sidebarWidth })}
            />

            <div className="ds-actions">
              <button type="button" onClick={onReset}>
                Reset to defaults
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
