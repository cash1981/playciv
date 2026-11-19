import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Item } from '../lib/api.js'
import { ActionCardThumb } from './ActionCardThumb.js'

const tech = {
  kind: 'tech',
  sheetName: 'TECH',
  id: 'tech-currency',
  itemNumber: 1,
  description: null,
  used: false,
  hidden: false,
  ownerId: null,
  name: 'Currency',
  level: 1,
} as unknown as Item

describe('ActionCardThumb', () => {
  it('shows the card art with the card name as alt text', () => {
    const markup = renderToStaticMarkup(<ActionCardThumb item={tech} />)
    expect(markup).toContain('action-card-thumb')
    expect(markup).not.toContain('help-button')
    expect(markup).toContain('alt="Currency"')
    expect(markup).toContain('/items/Currency')
  })

  it('has empty alt text when the row already names the card', () => {
    expect(renderToStaticMarkup(<ActionCardThumb item={tech} decorative />)).toContain('alt=""')
  })

  it('puts the card text behind a ? button, and has no button without text', () => {
    const markup = renderToStaticMarkup(<ActionCardThumb item={tech} help="Trade in a coin for culture." />)
    expect(markup).toContain('aria-label="Help: Currency"')
    expect(renderToStaticMarkup(<ActionCardThumb item={tech} help="" />)).not.toContain('help-button')
  })

  it('renders nothing when there is no card', () => {
    expect(renderToStaticMarkup(<ActionCardThumb item={undefined} />)).toBe('')
  })
})
