// @vitest-environment jsdom

import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PrivateLogWorkspace } from './PrivateLogWorkspace.js'

const noop = (): void => undefined

describe('PrivateLogWorkspace', () => {
  it('describes the note as private and saves it explicitly', () => {
    const markup = renderToStaticMarkup(
      <PrivateLogWorkspace
        note="Plan the next research choice"
        dirty={true}
        onChange={noop}
        tabPanelId="private-panel"
        labelledBy="private-tab"
      />,
    )

    expect(markup).toContain('Only you can see this planning space')
    expect(markup).toContain('does not add an entry to the game log')
    expect(markup).toContain('Private log')
    expect(markup).toContain('Unsaved changes: Private log')
    expect(markup).toContain('class="private-log-phase" data-save-status="unsaved"')
    expect(markup).toContain('aria-label="Private log"')
    expect(markup).not.toContain('Publish')
  })

  it('shows a saved note as saved and a failed save as failed', () => {
    const saved = renderToStaticMarkup(
      <PrivateLogWorkspace note="x" dirty={false} onChange={noop} tabPanelId="p" labelledBy="t" />,
    )
    expect(saved).toContain('Saved Private log')
    expect(saved).toContain('data-save-status="saved"')

    const failed = renderToStaticMarkup(
      <PrivateLogWorkspace
        note="x"
        dirty={true}
        saveStatus="failed"
        onChange={noop}
        tabPanelId="p"
        labelledBy="t"
      />,
    )
    expect(failed).toContain('Save failed: Private log')
  })

  it('keeps a gap above the note box, as the old Turn orders private log had', () => {
    const css = readFileSync('src/views/PrivateLogWorkspace.css', 'utf8').replaceAll('\r\n', '\n')
    const rule = /\.private-log-phase \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('margin-top: 0.8rem;')
  })
})
