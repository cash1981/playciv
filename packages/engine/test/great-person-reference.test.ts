/**
 * The great persons menu reference. Java had no such list; the counts come from
 * the `Great Person` sheet: 42 rows under a header, seven per type.
 */

import { describe, expect, it } from 'vitest'

import { GREAT_PERSON_REFERENCE } from '../src/create-game.js'
import { greatPersonReference } from '../src/gamedata.js'
import type { GameDataFile } from '../src/gamedata.js'

describe('greatPersonReference', () => {
  it('lists 42 great persons, seven for each of six types', () => {
    expect(GREAT_PERSON_REFERENCE).toHaveLength(42)
    const counts = new Map<string, number>()
    for (const person of GREAT_PERSON_REFERENCE) {
      counts.set(person.type, (counts.get(person.type) ?? 0) + 1)
    }
    expect(counts.size).toBe(6)
    expect([...counts.values()]).toEqual([7, 7, 7, 7, 7, 7])
  })

  it('knows Marie Curie is a Scientist with her printed text', () => {
    const curie = GREAT_PERSON_REFERENCE.find((person) => person.name === 'Marie Curie')
    expect(curie?.type).toBe('Scientist')
    expect(curie?.description).toContain('uranium')
  })

  it('keeps sheet order rather than shuffling', () => {
    const names = GREAT_PERSON_REFERENCE.map((person) => person.name)
    const pasteur = names.indexOf('Louis Pasteur')
    expect(pasteur).toBeGreaterThanOrEqual(0)
    expect(names[pasteur + 1]).toBe('Marie Curie')
  })

  it('reads whole rows so type and text stay with the name, and skips blank rows', () => {
    const data: GameDataFile = {
      gameType: 'WAW',
      source: 'test',
      sheets: {
        'Great Person': [
          ['Name', 'Type', 'Description', ''],
          [' Ada ', 'Scientist', ' Does a thing. ', ''],
          ['', '', '', ''],
          ['Bob', 'General', 'Does another.', ''],
        ],
      },
    }
    expect(greatPersonReference(data)).toEqual([
      { name: 'Ada', type: 'Scientist', description: 'Does a thing.' },
      { name: 'Bob', type: 'General', description: 'Does another.' },
    ])
  })
})
