const KNOWN_COLORS = new Set(['blue', 'green', 'purple', 'red', 'yellow'])

/**
 * Classes carry tuned shades (see `.player-blue` and friends in the stylesheet)
 * because the raw colour name is unreadable on the dark background, Blue and
 * Purple especially. An unknown or missing colour stays in the normal text colour.
 */
export function colorClass(color: string | null): string | undefined {
  const name = color?.toLowerCase()
  return name !== undefined && KNOWN_COLORS.has(name) ? `player-${name}` : undefined
}
