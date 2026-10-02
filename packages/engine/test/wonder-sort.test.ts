/**
 * Wonders sort by level (Ancient 1, Medieval 2, Modern 3), then alphabetically
 * within the level, ignoring a leading "The".
 */

import { describe, expect, it } from 'vitest'

import { compareWonderNames, WONDER_LEVELS } from '../src/create-game.js'

describe('wonder sorting', () => {
  it('knows the level of all 27 wonders, nine per level', () => {
    const counts = [1, 2, 3].map((level) => Object.values(WONDER_LEVELS).filter((l) => l === level).length)
    expect(counts).toEqual([9, 9, 9])
  })

  it('puts level 1 before 2 before 3, whatever the alphabet says', () => {
    // The Internet is Modern, The Pyramids is Ancient
    expect(WONDER_LEVELS['The Internet']).toBe(3)
    expect(WONDER_LEVELS['The Pyramids']).toBe(1)
    expect(['The Internet', 'The Pyramids'].sort(compareWonderNames)).toEqual([
      'The Pyramids',
      'The Internet',
    ])
  })

  it('sorts alphabetically within a level and ignores a leading "The"', () => {
    const names = Object.keys(WONDER_LEVELS).sort(compareWonderNames)
    for (const level of [1, 2, 3]) {
      const inLevel = names.filter((name) => WONDER_LEVELS[name] === level)
      const keys = inLevel.map((name) => name.replace(/^The /, ''))
      expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b, 'en')))
    }
    // A literal expectation, so a wrong "The" rule cannot pass by agreeing with itself
    expect(names.slice(0, 4)).toEqual(['Chichen Itza', 'The Colossus', 'The Great Lighthouse', 'The Great Wall'])
    // Levels are contiguous in the result
    expect(names.map((name) => WONDER_LEVELS[name])).toEqual(
      [...names.map((name) => WONDER_LEVELS[name])].sort(),
    )
  })

  it('sorts an unknown name after the known ones', () => {
    expect(['Aardvark Monument', 'The Internet'].sort(compareWonderNames)).toEqual([
      'The Internet',
      'Aardvark Monument',
    ])
  })
})
