// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_SETTINGS_KEY,
  ICON_SCALE_RANGE,
  MAP_ZOOM_RANGE,
  SIDEBAR_COLUMNS_RANGE,
  SIDEBAR_WIDTH_RANGE,
  clampToRange,
  loadDisplaySettings,
  parseDisplaySettings,
  saveDisplaySettings,
  serialiseDisplaySettings,
} from './displaySettings.js'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('display settings ranges and defaults', () => {
  it('has the documented defaults and ranges', () => {
    expect(DEFAULT_DISPLAY_SETTINGS).toEqual({
      mapZoom: 'auto',
      iconScale: 1,
      sidebarWidth: 16.5,
      sidebarColumns: 'auto',
      showLabels: true,
    })
    expect(MAP_ZOOM_RANGE).toEqual({ min: 0.25, max: 1.5, step: 0.05 })
    expect(ICON_SCALE_RANGE).toEqual({ min: 0.7, max: 1.5, step: 0.05 })
    expect(SIDEBAR_WIDTH_RANGE).toEqual({ min: 14, max: 24, step: 0.5 })
    expect(SIDEBAR_COLUMNS_RANGE).toEqual({ min: 1, max: 4, step: 1 })
  })

  it('clamps to the range and snaps to the step without float noise', () => {
    expect(clampToRange(0, MAP_ZOOM_RANGE)).toBe(0.25)
    expect(clampToRange(9, MAP_ZOOM_RANGE)).toBe(1.5)
    expect(clampToRange(0.35, MAP_ZOOM_RANGE)).toBe(0.35)
    expect(clampToRange(0.62, MAP_ZOOM_RANGE)).toBe(0.6)
    expect(clampToRange(17.3, SIDEBAR_WIDTH_RANGE)).toBe(17.5)
    expect(clampToRange(-5, SIDEBAR_WIDTH_RANGE)).toBe(14)
    expect(clampToRange(2, ICON_SCALE_RANGE)).toBe(1.5)
  })
})

describe('parseDisplaySettings', () => {
  it('round-trips what serialiseDisplaySettings writes', () => {
    const settings = { mapZoom: 0.65, iconScale: 1.2, sidebarWidth: 20, sidebarColumns: 3, showLabels: false } as const
    expect(parseDisplaySettings(serialiseDisplaySettings(settings))).toEqual(settings)
    expect(parseDisplaySettings(serialiseDisplaySettings(DEFAULT_DISPLAY_SETTINGS))).toEqual(DEFAULT_DISPLAY_SETTINGS)
  })

  it('gives the defaults for missing or unparsable input', () => {
    for (const raw of [null, '', 'not json', '{', 'null', '42', '"auto"', '[1,2,3]', 'true']) {
      expect(parseDisplaySettings(raw)).toEqual(DEFAULT_DISPLAY_SETTINGS)
    }
  })

  it('clamps stored values that are out of range', () => {
    expect(parseDisplaySettings('{"mapZoom":9,"iconScale":0.1,"sidebarWidth":99,"sidebarColumns":9}')).toEqual({
      mapZoom: 1.5,
      iconScale: 0.7,
      sidebarWidth: 24,
      sidebarColumns: 4,
      showLabels: true,
    })
  })

  it('replaces only the fields that are garbage', () => {
    expect(
      parseDisplaySettings('{"mapZoom":"huge","iconScale":"1.2","sidebarWidth":18,"showLabels":false}'),
    ).toEqual({ mapZoom: 'auto', iconScale: 1, sidebarWidth: 18, sidebarColumns: 'auto', showLabels: false })
    expect(parseDisplaySettings('{"mapZoom":null,"iconScale":null,"sidebarWidth":false,"showLabels":null}')).toEqual(DEFAULT_DISPLAY_SETTINGS)
    // Only a real boolean counts: the strings and numbers that look like one are garbage, and
    // garbage gives the default (on), even where it looks like an off.
    for (const garbage of ['"true"', '"false"', '1', '0', '"on"', '"off"', '[]', '{}']) {
      expect(parseDisplaySettings(`{"showLabels":${garbage},"iconScale":1.1}`)).toEqual({ ...DEFAULT_DISPLAY_SETTINGS, iconScale: 1.1 })
    }
    // And a bad showLabels does not take the other fields with it.
    expect(parseDisplaySettings('{"showLabels":"yes","sidebarWidth":20}')).toEqual({ ...DEFAULT_DISPLAY_SETTINGS, sidebarWidth: 20 })
    // 1e999 is Infinity once parsed.
    expect(parseDisplaySettings('{"mapZoom":1e999,"iconScale":1.1}')).toEqual({ ...DEFAULT_DISPLAY_SETTINGS, iconScale: 1.1 })
  })

  it('keeps an explicit showLabels false, and turns the labels on when it is missing (settings saved before it existed)', () => {
    expect(parseDisplaySettings('{"showLabels":true}')).toEqual({ ...DEFAULT_DISPLAY_SETTINGS, showLabels: true })
    expect(parseDisplaySettings('{"showLabels":false,"iconScale":1.3}')).toEqual({
      ...DEFAULT_DISPLAY_SETTINGS,
      iconScale: 1.3,
      showLabels: false,
    })
    expect(parseDisplaySettings('{"mapZoom":0.5,"iconScale":1.4,"sidebarWidth":22}').showLabels).toBe(true)
  })

  it('reads icons per row: a number from 1 to 4, and auto for anything else (including settings saved before it existed)', () => {
    expect(parseDisplaySettings('{"sidebarColumns":2}').sidebarColumns).toBe(2)
    expect(parseDisplaySettings('{"sidebarColumns":0}').sidebarColumns).toBe(1)
    expect(parseDisplaySettings('{"sidebarColumns":2.6}').sidebarColumns).toBe(3)
    expect(parseDisplaySettings('{"sidebarColumns":"auto"}').sidebarColumns).toBe('auto')
    expect(parseDisplaySettings('{"mapZoom":0.5}').sidebarColumns).toBe('auto')
    for (const garbage of ['"3"', 'null', 'true', '[]', '{}', '1e999']) {
      expect(parseDisplaySettings(`{"sidebarColumns":${garbage}}`).sidebarColumns).toBe('auto')
    }
  })

  it('accepts auto and ignores unknown fields', () => {
    expect(parseDisplaySettings('{"mapZoom":"auto","iconScale":1.3,"extra":1}')).toEqual({
      ...DEFAULT_DISPLAY_SETTINGS,
      iconScale: 1.3,
    })
  })
})

describe('loadDisplaySettings and saveDisplaySettings', () => {
  it('start from the defaults when nothing is stored, and read back what was saved', () => {
    expect(loadDisplaySettings()).toEqual(DEFAULT_DISPLAY_SETTINGS)
    saveDisplaySettings({ mapZoom: 0.5, iconScale: 0.9, sidebarWidth: 15, sidebarColumns: 'auto', showLabels: false })
    expect(localStorage.getItem(DISPLAY_SETTINGS_KEY)).toBe(
      '{"mapZoom":0.5,"iconScale":0.9,"sidebarWidth":15,"sidebarColumns":"auto","showLabels":false}',
    )
    expect(loadDisplaySettings()).toEqual({ mapZoom: 0.5, iconScale: 0.9, sidebarWidth: 15, sidebarColumns: 'auto', showLabels: false })
  })

  it('ignore corrupt stored data', () => {
    localStorage.setItem(DISPLAY_SETTINGS_KEY, '{oops')
    expect(loadDisplaySettings()).toEqual(DEFAULT_DISPLAY_SETTINGS)
  })

  it('do not throw when storage throws on every access', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
    })
    expect(loadDisplaySettings()).toEqual(DEFAULT_DISPLAY_SETTINGS)
    expect(() => saveDisplaySettings(DEFAULT_DISPLAY_SETTINGS)).not.toThrow()
  })

  it('do not throw when the storage object itself is not reachable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadDisplaySettings()).toEqual(DEFAULT_DISPLAY_SETTINGS)
    expect(() => saveDisplaySettings(DEFAULT_DISPLAY_SETTINGS)).not.toThrow()
  })
})
