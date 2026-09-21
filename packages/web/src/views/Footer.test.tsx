// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../App.js'
import { Footer } from './Footer.js'

// App imports GameView, which pulls in the Milkdown editor. It needs a real DOM
// API that jsdom does not provide, and the footer does not touch it.
vi.mock('./GameView.js', () => ({ GameView: () => null }))

afterEach(cleanup)

describe('Footer', () => {
  it('shows the copyright, the license link and the old PayPal donation form', () => {
    const { container } = render(<Footer />)
    const footer = screen.getByRole('contentinfo')

    expect(footer.textContent).toContain(
      'Copyright \u00a9 2015\u20132026 by Shervin Asgari. All rights reserved.',
    )

    const license = within(footer).getByRole('link', { name: 'Apache 2.0 License' })
    expect(license.getAttribute('href')).toBe('https://www.apache.org/licenses/LICENSE-2.0')
    expect(license.getAttribute('rel')).toBe('noopener noreferrer')

    const form = container.querySelector('form')
    expect(form?.getAttribute('action')).toBe('https://www.paypal.com/cgi-bin/webscr')
    expect(form?.getAttribute('method')).toBe('post')

    expect(container.querySelector<HTMLInputElement>('input[name="cmd"]')?.value).toBe('_s-xclick')
    const encrypted = container.querySelector<HTMLInputElement>('input[name="encrypted"]')?.value
    // The same encrypted hosted button the old client posted.
    expect(encrypted?.startsWith('-----BEGIN PKCS7-----')).toBe(true)
    expect(encrypted?.endsWith('-----END PKCS7-----')).toBe(true)
  })

  it('shows the Buy Me a Coffee button beside the PayPal form', () => {
    const { container } = render(<Footer />)

    const link = screen.getByRole('link', { name: 'Buy me a coffee' })
    expect(link.getAttribute('href')).toBe('https://www.buymeacoffee.com/cash1981')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')

    const image = within(link).getByRole('img', { name: 'Buy me a coffee' })
    const src = image.getAttribute('src') ?? ''
    expect(src.startsWith('https://img.buymeacoffee.com/button-api/?')).toBe(true)
    expect(src).toContain('slug=cash1981')

    // It sits in the same right-hand area as the donate form, so it shows
    // wherever the footer does.
    const support = container.querySelector('.site-footer-support')
    expect(support?.querySelector('form')).toBeTruthy()
    expect(support?.querySelector('a.site-footer-coffee')).toBe(link)
  })

  it('does not carry the Patreon link the old footer also had', () => {
    const { container } = render(<Footer />)
    expect(container.textContent).not.toMatch(/patreon/i)
    expect(container.innerHTML).not.toMatch(/patreon/i)
  })
})

describe('App', () => {
  it.each([
    ['/about', 'About Civilization'],
    ['/faq', 'Frequently asked questions'],
  ])('renders the footer on the public %s page', async (path, heading) => {
    window.history.replaceState(null, '', path)
    render(<App />)

    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
    expect(screen.getByRole('contentinfo')).toBeTruthy()
  })
})
