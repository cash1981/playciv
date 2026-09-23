import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  readonly id: string
  readonly title: string
  readonly defaultOpen?: boolean
  readonly className?: string
  readonly children: ReactNode
}

/**
 * A panel whose open state is remembered across a page reload, keyed by
 * `id` in `localStorage` (issue #71). `defaultOpen` is only the fallback for
 * the first time a given `id` is ever seen on this browser.
 */
export function CollapsiblePanel({
  id,
  title,
  defaultOpen = false,
  className = '',
  children,
}: Props): React.JSX.Element {
  const storageKey = `civ.panel.${id}`
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored === null ? defaultOpen : stored === 'true'
    } catch {
      return defaultOpen
    }
  })
  const contentId = `${id}-content`

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(open)) } catch {}
  }, [storageKey, open])

  return (
    <section className={`panel collapsible-panel ${className}`.trim()}>
      <h2 className="collapsible-heading">
        <button
          type="button"
          className="collapsible-toggle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((current) => !current)}
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
