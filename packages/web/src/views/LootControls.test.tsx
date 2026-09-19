// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Item } from '@civ/engine'

import { LootControls } from './GameView.js'

afterEach(cleanup)

const item = (sheetName: 'CULTURE_1' | 'CULTURE_2' | 'CULTURE_3' | 'HUTS' | 'VILLAGES'): Item => {
  const common = {
    id: `item-${sheetName}`,
    itemNumber: 1,
    description: 'secret description',
    used: false,
    hidden: true,
    ownerId: 'player-me',
    name: 'secret name',
    type: null,
  } as const

  switch (sheetName) {
    case 'CULTURE_1': return { ...common, kind: 'cultureI', sheetName }
    case 'CULTURE_2': return { ...common, kind: 'cultureII', sheetName }
    case 'CULTURE_3': return { ...common, kind: 'cultureIII', sheetName }
    case 'HUTS': return { ...common, kind: 'hut', sheetName }
    case 'VILLAGES': return { ...common, kind: 'village', sheetName }
  }
}

const opponents = [
  { playerId: 'player-them', username: 'Opponent' },
] as const

describe('LootControls', () => {
  it('offers exactly the old categories present in the viewer own hand', () => {
    const { container } = render(
      <LootControls
        items={[item('CULTURE_3'), item('HUTS')]}
        opponents={opponents}
        busy={false}
        onLoot={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: 'Loot Culture Card' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Loot Huts' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Loot Villages' })).toBeNull()
    expect(container.textContent).not.toContain('secret name')
    expect(container.textContent).not.toContain('secret description')
  })

  it('requires an opponent and sends the chosen category deliberately', () => {
    const onLoot = vi.fn()
    render(
      <LootControls
        items={[item('CULTURE_1'), item('VILLAGES')]}
        opponents={opponents}
        busy={false}
        onLoot={onLoot}
      />,
    )

    const culture = screen.getByRole('button', { name: 'Loot Culture Card' }) as HTMLButtonElement
    expect(culture.disabled).toBe(true)

    fireEvent.change(screen.getByRole('combobox', { name: 'Player receiving loot' }), {
      target: { value: 'player-them' },
    })
    expect(culture.disabled).toBe(false)

    fireEvent.click(culture)
    expect(onLoot).toHaveBeenCalledOnce()
    expect(onLoot).toHaveBeenCalledWith('CULTURE_CARD', 'player-them')
  })

  it('renders no loot UI when the hand has no lootable category', () => {
    const { container } = render(
      <LootControls items={[]} opponents={opponents} busy={false} onLoot={() => undefined} />,
    )

    expect(container.innerHTML).toBe('')
  })
})
