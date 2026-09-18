import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ChatTimestamp } from './ChatTimestamp.js'

describe('ChatTimestamp', () => {
  it('omits the time element when the timestamp is invalid', () => {
    const markup = renderToStaticMarkup(<ChatTimestamp createdAt="not-a-date" />)

    expect(markup).toBe('')
    expect(markup).not.toContain('log-time')
  })

  it('renders a valid timestamp in the log format', () => {
    const markup = renderToStaticMarkup(<ChatTimestamp createdAt="2026-09-18T07:08:09" />)

    expect(markup).toContain('<time class="log-time"')
    expect(markup).toContain('18.09.2026 07:08:09')
  })
})
