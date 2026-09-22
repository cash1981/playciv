/**
 * One card in a `ReferenceDialog`: its printed artwork, its name and the
 * caller's text. A reference is public player aid, so a missing image simply
 * leaves the name and text readable, as the old app did when an item had no
 * artwork.
 */

import type { ReactNode } from 'react'

interface Props {
  readonly name: string
  readonly image: string | null
  readonly imageAlt: string
  readonly children?: ReactNode
}

export function ReferenceCard({ name, image, imageAlt, children }: Props): React.JSX.Element {
  return (
    <article className="reference-card">
      {image !== null && (
        <img className="reference-card-image" src={image} alt={imageAlt} loading="lazy" />
      )}
      <div className="reference-card-copy">
        <h3>{name}</h3>
        {children}
      </div>
    </article>
  )
}
