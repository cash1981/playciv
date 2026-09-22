// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SiteBackdrop } from './SiteBackdrop.js'

afterEach(cleanup)

describe('SiteBackdrop', () => {
  it('is decorative: nothing inside it is exposed to assistive technology', () => {
    const { container } = render(<SiteBackdrop />)
    const backdrop = container.querySelector('.site-backdrop')

    expect(backdrop).not.toBeNull()
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true')
    // If anything in here were focusable or labelled, a screen reader would
    // announce a decoration before the page itself.
    expect(backdrop?.querySelectorAll('a, button, input, [role], [tabindex]')).toHaveLength(0)
  })

  it('renders all three layers, so the scrim always sits over the photo', () => {
    const { container } = render(<SiteBackdrop />)

    // `className` is an `SVGAnimatedString` on the <svg> layer, so read the
    // attribute rather than the property.
    const layers = [...(container.querySelector('.site-backdrop')?.children ?? [])].map((child) =>
      child.getAttribute('class'),
    )
    expect(layers).toEqual([
      'site-backdrop-photo',
      'site-backdrop-scrim',
      'site-backdrop-cartography',
    ])
  })
})
