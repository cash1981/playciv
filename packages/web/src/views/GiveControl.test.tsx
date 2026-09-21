// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Item, TechItem } from '@civ/engine'

import { GiveControl } from './GameView.js'

afterEach(cleanup)

const base = {
  itemNumber: 1,
  description: null,
  used: false,
  hidden: true,
  ownerId: 'player-me',
  name: 'card',
  type: null,
} as const

const tradable = (
  sheetName: 'CULTURE_1' | 'CULTURE_2' | 'CULTURE_3' | 'HUTS' | 'VILLAGES',
): Item => {
  switch (sheetName) {
    case 'CULTURE_1':
      return { ...base, id: 'culture-1', sheetName, kind: 'cultureI' }
    case 'CULTURE_2':
      return { ...base, id: 'culture-2', sheetName, kind: 'cultureII' }
    case 'CULTURE_3':
      return { ...base, id: 'culture-3', sheetName, kind: 'cultureIII' }
    case 'HUTS':
      return { ...base, id: 'hut', sheetName, kind: 'hut' }
    case 'VILLAGES':
      return { ...base, id: 'village', sheetName, kind: 'village' }
  }
}

const greatPerson: Item = {
  ...base,
  id: 'great-person',
  sheetName: 'GREAT_PERSON',
  kind: 'greatperson',
  name: 'Louis Pasteur',
  type: 'Scientist',
}

const startingTech: TechItem = {
  ...base,
  id: 'tech-writing',
  itemNumber: 2,
  hidden: false,
  name: 'Writing',
  sheetName: 'LEVEL_1_TECH',
  kind: 'tech',
  level: 1,
}

const civ: Item = {
  ...base,
  id: 'civ',
  sheetName: 'CIV',
  kind: 'civ',
  name: 'England',
  startingTech,
}

const cityState: Item = {
  ...base,
  id: 'city-state',
  sheetName: 'CITY_STATES',
  kind: 'citystate',
  name: '3 Cultures',
}

const run = async (): Promise<void> => undefined

describe('GiveControl', () => {
  it.each(['CULTURE_1', 'CULTURE_2', 'CULTURE_3', 'HUTS', 'VILLAGES'] as const)(
    'shows the selector and Give button for %s',
    (sheetName) => {
      render(
        <GiveControl item={tradable(sheetName)} gameId="g" busy={false} run={run} opponents={[]} />,
      )
      expect(screen.getByRole('combobox')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Give' })).toBeTruthy()
    },
  )

  it.each([
    ['great person', greatPerson],
    ['civ', civ],
    ['city-state', cityState],
  ] as const)('renders no Give control for a %s', (_label, item) => {
    const { container } = render(
      <GiveControl item={item} gameId="g" busy={false} run={run} opponents={[]} />,
    )
    expect(container.innerHTML).toBe('')
  })
})
