// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TechTree, techCardImageUrl } from './TechTree.js'
import type { TechTreePlacement, TechTreeTech } from './TechTree.js'

afterEach(() => cleanup())

describe('TechTree', () => {
  it('lays out five rows, narrowing from 5 slots at level 1 to 1 slot at level 5', () => {
    const { container } = render(<TechTree techs={[]} />)

    const rows = container.querySelectorAll('.tech-pyramid-row')
    expect(rows).toHaveLength(5)
    // Apex (level 5) first, base (level 1) last.
    expect(rows[0]?.querySelectorAll('.tech-slot')).toHaveLength(1)
    expect(rows[1]?.querySelectorAll('.tech-slot')).toHaveLength(2)
    expect(rows[2]?.querySelectorAll('.tech-slot')).toHaveLength(3)
    expect(rows[3]?.querySelectorAll('.tech-slot')).toHaveLength(4)
    expect(rows[4]?.querySelectorAll('.tech-slot')).toHaveLength(5)
  })

  it('shows the trade cost on an empty slot, and nothing on a level 5 empty slot', () => {
    const { container } = render(<TechTree techs={[]} />)

    const level1Row = container.querySelectorAll('.tech-pyramid-row')[4]
    expect(level1Row?.querySelector('.tech-slot.available')?.textContent).toBe('6')

    const level5Row = container.querySelectorAll('.tech-pyramid-row')[0]
    expect(level5Row?.querySelector('.tech-slot.available')?.textContent).toBe('')
  })

  it('gives a researched slot the card image, the name as a fallback, and marks a hidden one', () => {
    const techs: readonly TechTreeTech[] = [
      { name: 'Writing', level: 1 },
      { name: 'Space Flight', level: 5, hidden: true },
    ]
    const { container } = render(<TechTree techs={techs} />)

    const writingSlot = Array.from(container.querySelectorAll('.tech-slot.researched')).find(
      (slot) => slot.textContent?.includes('Writing'),
    )
    expect(writingSlot).toBeTruthy()
    expect(writingSlot?.getAttribute('title')).toBe('Writing')
    const image = writingSlot?.querySelector('img')
    expect(image?.getAttribute('src')).toBe(techCardImageUrl('Writing'))
    expect(writingSlot?.querySelector('.tech-slot-label')?.textContent).toBe('Writing')
    expect(writingSlot?.classList.contains('hidden')).toBe(false)

    const spaceFlightSlot = Array.from(container.querySelectorAll('.tech-slot.researched')).find(
      (slot) => slot.textContent?.includes('Space Flight'),
    )
    expect(spaceFlightSlot?.classList.contains('hidden')).toBe(true)
    expect(spaceFlightSlot?.querySelector('img')?.getAttribute('src')).toBe(
      techCardImageUrl('Space Flight'),
    )
  })

  it('hides a broken card image on error, leaving the name readable underneath', () => {
    const techs: readonly TechTreeTech[] = [{ name: 'Writing', level: 1 }]
    const { container } = render(<TechTree techs={techs} />)

    const image = container.querySelector<HTMLImageElement>('.tech-slot-image')
    expect(image).not.toBeNull()
    image?.dispatchEvent(new Event('error'))

    expect(image?.style.display).toBe('none')
    expect(container.querySelector('.tech-slot-label')?.textContent).toBe('Writing')
  })

  it('strips spaces from a multi-word tech name for the image URL', () => {
    expect(techCardImageUrl('Horseback Riding')).toBe('/items/HorsebackRiding.jpg')
  })

  it('renders a tech in its overridden slot, not its real level', () => {
    const techs: readonly TechTreeTech[] = [{ name: 'Writing', level: 1, slot: 4 }]
    const { container } = render(<TechTree techs={techs} />)

    const rows = container.querySelectorAll('.tech-pyramid-row')
    // Apex (level 5) first, base (level 1) last — slot 4 is rows[1].
    expect(rows[1]?.textContent).toContain('Writing')
    expect(rows[4]?.textContent).not.toContain('Writing')
  })

  it('renders a placement as a blank occupant with the generic card back', () => {
    const placements: readonly TechTreePlacement[] = [{ name: 'Sir Isaac Newton', slot: 3 }]
    const { container } = render(<TechTree techs={[]} placements={placements} />)

    const rows = container.querySelectorAll('.tech-pyramid-row')
    const slot = rows[2]?.querySelector('.tech-slot.placement')
    expect(slot?.textContent).toContain('Sir Isaac Newton')
    expect(slot?.querySelector('img')?.getAttribute('src')).toBe('/items/greatperson_back.jpg')
  })

  it('does not render a stepper when no onXSlotChange handler is given (read-only, e.g. an opponent tab)', () => {
    const techs: readonly TechTreeTech[] = [{ name: 'Writing', level: 1 }]
    const placements: readonly TechTreePlacement[] = [{ name: 'Sir Isaac Newton', slot: 3 }]
    const { container } = render(<TechTree techs={techs} placements={placements} />)

    expect(container.querySelector('.tech-slot-move')).toBeNull()
  })

  it('moves a tech one row at a time via the stepper, calling back with the new slot', () => {
    const techs: readonly TechTreeTech[] = [{ name: 'Writing', level: 1, slot: 3 }]
    const calls: [string, number][] = []
    const { container } = render(
      <TechTree techs={techs} onTechSlotChange={(name, slot) => calls.push([name, slot])} />,
    )

    const buttons = container.querySelectorAll('.tech-slot-move button')
    expect(buttons).toHaveLength(2)
    buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(calls).toEqual([
      ['Writing', 2],
      ['Writing', 4],
    ])
  })

  it('moves a placement one row at a time via the stepper, calling back with the new slot', () => {
    const placements: readonly TechTreePlacement[] = [{ name: 'Sir Isaac Newton', slot: 3 }]
    const calls: [string, number][] = []
    const { container } = render(
      <TechTree
        techs={[]}
        placements={placements}
        onPlacementSlotChange={(name, slot) => calls.push([name, slot])}
      />,
    )

    const buttons = container.querySelectorAll('.tech-slot-move button')
    expect(buttons).toHaveLength(2)
    buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(calls).toEqual([['Sir Isaac Newton', 2]])
  })

  it('disables the stepper buttons at the pyramid edges', () => {
    const techs: readonly TechTreeTech[] = [{ name: 'Writing', level: 1, slot: 1 }]
    const { container } = render(<TechTree techs={techs} onTechSlotChange={() => {}} />)

    const buttons = container.querySelectorAll<HTMLButtonElement>('.tech-slot-move button')
    expect(buttons[0]?.disabled).toBe(true) // already at row 1, cannot go lower
    expect(buttons[1]?.disabled).toBe(false)
  })
})
