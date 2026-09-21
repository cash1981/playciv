// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Item } from '@civ/engine'

import { GreatPersonDiscardControls } from './GameView.js'

afterEach(cleanup)

const greatPerson = (id: string, type: string): Item => ({
  id,
  itemNumber: 1,
  description: 'secret description',
  used: false,
  hidden: true,
  ownerId: 'player-me',
  name: 'secret name',
  sheetName: 'GREAT_PERSON',
  kind: 'greatperson',
  type,
})

describe('GreatPersonDiscardControls', () => {
  it('offers a type only when two or more of it are held', () => {
    const { container } = render(
      <GreatPersonDiscardControls
        items={[
          greatPerson('g1', 'General'),
          greatPerson('g2', 'General'),
          greatPerson('s1', 'Scientist'),
        ]}
        busy={false}
        onDiscard={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: 'Discard random General' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Discard random Scientist' })).toBeNull()
    expect(container.textContent).not.toContain('secret name')
    expect(container.textContent).not.toContain('secret description')
  })

  it('sends the chosen type deliberately', () => {
    const onDiscard = vi.fn()
    render(
      <GreatPersonDiscardControls
        items={[greatPerson('g1', 'General'), greatPerson('g2', 'General')]}
        busy={false}
        onDiscard={onDiscard}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Discard random General' }))
    expect(onDiscard).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledWith('General')
  })

  it('renders nothing when no type is held twice', () => {
    const { container } = render(
      <GreatPersonDiscardControls
        items={[greatPerson('g1', 'General'), greatPerson('s1', 'Scientist')]}
        busy={false}
        onDiscard={() => undefined}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for an empty hand', () => {
    const { container } = render(
      <GreatPersonDiscardControls items={[]} busy={false} onDiscard={() => undefined} />,
    )
    expect(container.innerHTML).toBe('')
  })
})
