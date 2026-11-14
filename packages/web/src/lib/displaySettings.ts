/**
 * Per-browser display settings (issue #342): how large the map is drawn, how
 * large the icons of the player status sidebar are, how wide that sidebar is, how
 * many icons it shows per row and whether it names every value above its icon.
 *
 * They are a matter of screen and eyesight, not of the game, so they live in
 * `localStorage` of this browser and never reach the server. Everything here is
 * pure apart from `loadDisplaySettings` and `saveDisplaySettings`, which swallow
 * every storage failure: private modes and blocked storage must not break the page.
 */

export interface DisplaySettings {
  /** A fixed zoom, or `auto` to fit the board to the width the map gets. */
  readonly mapZoom: number | 'auto'
  /** Multiplier on the size of the status icons and their numbers. */
  readonly iconScale: number
  /** Width of the status sidebar beside the map, in rem. Unused when it is stacked under the map. */
  readonly sidebarWidth: number
  /** Icons per row in each group of the status sidebar, or `auto` to fit as many as the width allows. */
  readonly sidebarColumns: number | 'auto'
  /** Whether every status value is named in small text above its icon, instead of only in its tooltip. */
  readonly showLabels: boolean
}

export interface SettingRange {
  readonly min: number
  readonly max: number
  readonly step: number
}

export const DISPLAY_SETTINGS_KEY = 'civ.display'

export const MAP_ZOOM_RANGE: SettingRange = { min: 0.25, max: 1.5, step: 0.05 }
export const ICON_SCALE_RANGE: SettingRange = { min: 0.7, max: 1.5, step: 0.05 }
export const SIDEBAR_WIDTH_RANGE: SettingRange = { min: 14, max: 24, step: 0.5 }
/** Each group of the sidebar holds four stats, so more than four columns would only leave gaps. */
export const SIDEBAR_COLUMNS_RANGE: SettingRange = { min: 1, max: 4, step: 1 }

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  mapZoom: 'auto',
  iconScale: 1,
  sidebarWidth: 16.5,
  sidebarColumns: 'auto',
  showLabels: true,
}

/** Clamps into the range and snaps to its step, so a stored value is always one the slider can show. */
export function clampToRange(value: number, range: SettingRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, value))
  const snapped = range.min + Math.round((clamped - range.min) / range.step) * range.step
  // Multiples of 0.05 are not exact in binary; round the noise away (0.35 stays 0.35).
  return Math.min(range.max, Math.round(snapped * 1000) / 1000)
}

function numberIn(value: unknown, range: SettingRange, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clampToRange(value, range) : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads stored JSON. Each field is validated on its own: one bad field falls back
 * to its default without discarding the others, and anything that is not an
 * object gives all defaults.
 */
export function parseDisplaySettings(raw: string | null): DisplaySettings {
  if (raw === null) return DEFAULT_DISPLAY_SETTINGS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_DISPLAY_SETTINGS
  }
  if (!isRecord(parsed)) return DEFAULT_DISPLAY_SETTINGS
  const { mapZoom, showLabels, sidebarColumns } = parsed
  return {
    // Anything but a finite number or 'auto' is the default, which is auto.
    mapZoom: typeof mapZoom === 'number' && Number.isFinite(mapZoom) ? clampToRange(mapZoom, MAP_ZOOM_RANGE) : 'auto',
    iconScale: numberIn(parsed['iconScale'], ICON_SCALE_RANGE, DEFAULT_DISPLAY_SETTINGS.iconScale),
    sidebarWidth: numberIn(parsed['sidebarWidth'], SIDEBAR_WIDTH_RANGE, DEFAULT_DISPLAY_SETTINGS.sidebarWidth),
    // Anything but a finite number or 'auto' is the default, which is auto.
    sidebarColumns:
      typeof sidebarColumns === 'number' && Number.isFinite(sidebarColumns)
        ? clampToRange(sidebarColumns, SIDEBAR_COLUMNS_RANGE)
        : 'auto',
    showLabels: typeof showLabels === 'boolean' ? showLabels : DEFAULT_DISPLAY_SETTINGS.showLabels,
  }
}

export function serialiseDisplaySettings(settings: DisplaySettings): string {
  return JSON.stringify(settings)
}

export function loadDisplaySettings(): DisplaySettings {
  try {
    return parseDisplaySettings(localStorage.getItem(DISPLAY_SETTINGS_KEY))
  } catch {
    return DEFAULT_DISPLAY_SETTINGS
  }
}

export function saveDisplaySettings(settings: DisplaySettings): void {
  try {
    localStorage.setItem(DISPLAY_SETTINGS_KEY, serialiseDisplaySettings(settings))
  } catch {}
}
