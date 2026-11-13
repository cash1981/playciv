import type { ReactNode } from 'react'

import { usePanelOpen } from './usePanelOpen.js'

interface Props {
  readonly id: string
  readonly title: string
  readonly defaultOpen?: boolean
  readonly className?: string
  readonly children: ReactNode
}

/**
 * A panel whose open state is remembered across a page reload, keyed by
 * `id` in `localStorage` (issue #71; see `usePanelOpen`). `defaultOpen` is only
 * the fallback for the first time a given `id` is ever seen on this browser.
 */
export function CollapsiblePanel({
  id,
  title,
  defaultOpen = false,
  className = '',
  children,
}: Props): React.JSX.Element {
  const [open, setOpen] = usePanelOpen(id, defaultOpen)
  const contentId = `${id}-content`

  return (
    <section className={`panel collapsible-panel ${className}`.trim()}>
      <h2 className="collapsible-heading">
        <button
          type="button"
          className="collapsible-toggle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(!open)}
        >
          <span>{title}</span>
          <span className="collapsible-indicator" aria-hidden="true">
            {open ? '−' : '+'}
          </span>
        </button>
      </h2>
      <div id={contentId} className="collapsible-content" hidden={!open}>
        {children}
      </div>
    </section>
  )
}
