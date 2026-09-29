// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GREAT_PERSON_REFERENCE } from '@civ/engine'

import { GreatPersonsDialog } from './GreatPersonsDialog.js'

afterEach(cleanup)

const TYPES = [
  'Artist or Thinker',
  'Builder or Inventor',
  'General',
  'Humanitarian',
  'Merchant or Explorer',
  'Scientist',
]

function names(type: string): string[] {
  return GREAT_PERSON_REFERENCE.filter((p) => p.type === type).map((p) => p.name)
}

describe('GreatPersonsDialog', () => {
  it('has one tab per type and starts on the first type in sheet order', () => {
    const { container } = render(<GreatPersonsDialog onClose={vi.fn()} />)
    const tabs = Array.from(container.querySelectorAll('button.tab'))
    expect(tabs.map((tab) => tab.textContent)).toEqual(TYPES)
    expect(tabs).toHaveLength(6)
    expect(tabs[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7)
  })

  it('shows only the selected type, each card with name and description', () => {
    render(<GreatPersonsDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scientist' }))

    const shown = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(shown).toEqual(names('Scientist'))
    expect(screen.getByText('Marie Curie')).not.toBeNull()
    const curie = GREAT_PERSON_REFERENCE.find((p) => p.name === 'Marie Curie')
    expect(screen.getByText(curie?.description ?? 'missing')).not.toBeNull()
    for (const other of TYPES.filter((type) => type !== 'Scientist')) {
      for (const name of names(other)) expect(screen.queryByText(name)).toBeNull()
    }
  })

  it('closes on Escape and returns focus to the opener', () => {
    function Host(): React.JSX.Element {
      const [open, setOpen] = useState(false)
      const openerRef = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button ref={openerRef} onClick={() => setOpen(true)}>
            Open
          </button>
          {open && <GreatPersonsDialog returnFocusTo={openerRef} onClose={() => setOpen(false)} />}
        </>
      )
    }
    render(<Host />)
    const opener = screen.getByRole('button', { name: 'Open' })
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('shows exactly the printed catalogue across its tabs and nothing else', () => {
    const { container } = render(<GreatPersonsDialog onClose={vi.fn()} />)
    const names: string[] = []
    for (const tab of Array.from(container.querySelectorAll('button.tab'))) {
      fireEvent.click(tab)
      for (const heading of screen.getAllByRole('heading', { level: 3 })) names.push(heading.textContent ?? '')
    }
    expect(names).toEqual(GREAT_PERSON_REFERENCE.map((person) => person.name))
  })
})
