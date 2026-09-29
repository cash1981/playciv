// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SafeMarkdown, safeUrl } from './SafeMarkdown.js'

afterEach(cleanup)

const html = (markdown: string): HTMLElement => render(<SafeMarkdown markdown={markdown} />).container

describe('SafeMarkdown', () => {
  it('renders ordinary markdown', () => {
    const container = html('**bold** and _quiet_\n\n- one\n- two')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('quiet')
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('shows a script tag as text and never creates a script element', () => {
    const container = html('<script>window.hacked = true</script>')
    expect(container.querySelector('script')).toBeNull()
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined()
  })

  it('does not turn an img with an onerror handler into an element', () => {
    const container = html('<img src="x" onerror="window.hacked = true">')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
  })

  it('drops a javascript: link target but keeps the text', () => {
    const container = html('[click me](javascript:alert(1))')
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('click me')
    expect(container.innerHTML).not.toContain('javascript:')
  })

  it('drops data: and vbscript: link targets too', () => {
    expect(html('[a](data:text/html;base64,PHNjcmlwdD4=)').querySelector('a')).toBeNull()
    expect(html('[b](vbscript:msgbox)').querySelector('a')).toBeNull()
  })

  it('opens http, https and mailto links in a new tab with noopener', () => {
    const container = html('[a](http://example.com) [b](https://example.com/x) [c](mailto:a@b.no)')
    const links = Array.from(container.querySelectorAll('a'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'http://example.com',
      'https://example.com/x',
      'mailto:a@b.no',
    ])
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it('does not load a remote image, only shows its alt text', () => {
    const container = html('![the map](https://example.com/track.png)')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('the map')
  })

  it('allows an absolute link only', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com')
    expect(safeUrl('/relative')).toBe('')
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBe('')
  })
})
