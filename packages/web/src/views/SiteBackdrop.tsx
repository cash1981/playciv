/**
 * The decorative backdrop behind the whole site.
 *
 * Three stacked layers: the painted map, a theme-aware scrim that keeps panels
 * and text readable over it, and a cartography overlay (contour lines, a
 * graticule and a compass rose) drawn in `--map-ink` so it matches whichever
 * theme is active.
 *
 * It is presentational only — `aria-hidden`, no props, no state, no data — so
 * it can neither change behaviour nor reach the accessibility tree or a test's
 * queries.
 */
export function SiteBackdrop(): React.JSX.Element {
  return (
    <div className="site-backdrop" aria-hidden="true">
      <div className="site-backdrop-photo" />
      <div className="site-backdrop-scrim" />
      <svg
        className="site-backdrop-cartography"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      >
        <g opacity={0.5}>
          <path d="M-40 610 C 120 560, 210 690, 380 640 S 640 500, 830 600 S 1080 720, 1260 640" />
          <path d="M-40 660 C 130 615, 220 745, 395 695 S 655 560, 845 655 S 1090 770, 1260 695" />
          <path d="M-40 545 C 110 500, 200 625, 365 580 S 630 450, 815 545 S 1070 660, 1260 585" />
        </g>
        <g opacity={0.14} strokeDasharray="2 6">
          <path d="M0 200 H1200" />
          <path d="M0 400 H1200" />
          <path d="M0 600 H1200" />
          <path d="M300 0 V800" />
          <path d="M600 0 V800" />
          <path d="M900 0 V800" />
        </g>
        <g transform="translate(1010 660)" opacity={0.6}>
          <circle r="62" />
          <circle r="46" strokeDasharray="3 5" />
          <circle r="72" />
          <path d="M0 -62 L14 0 L0 62 L-14 0 Z" fill="currentColor" fillOpacity={0.25} />
          <path d="M-62 0 L0 14 L62 0 L0 -14 Z" fill="currentColor" fillOpacity={0.12} />
          <path d="M0 -86 L6 -8 L0 0 L-6 -8 Z" fill="currentColor" fillOpacity={0.5} />
          <path d="M0 86 L-6 8 L0 0 L6 8 Z" fill="currentColor" fillOpacity={0.35} />
          <text
            x="0"
            y="-96"
            textAnchor="middle"
            fontSize={16}
            fill="currentColor"
            stroke="none"
            fontFamily="Georgia, serif"
          >
            N
          </text>
        </g>
      </svg>
    </div>
  )
}
