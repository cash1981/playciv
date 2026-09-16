import { useState } from 'react'
import type { ReactNode } from 'react'

interface Props {
  readonly id: string
  readonly title: string
  readonly defaultOpen?: boolean
  readonly className?: string
  readonly children: ReactNode
}

/** A panel whose open state belongs to the current browser view. */
export function CollapsiblePanel({
  id,
  title,
  defaultOpen = true,
  className = '',
  children,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = `${id}-content`

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
