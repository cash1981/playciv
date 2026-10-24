/**
 * The text of the green toast after an action went through.
 *
 * The lines come from the server's confirmation route, which answers with the viewer's
 * own private log text and nothing of anyone else's. With nothing to say it is a
 * plain "Done". The viewer's own username is replaced by "you"/"your": whoever pressed
 * the button already knows the action is theirs, and the toast is not a log line.
 */

export const DONE_TEXT = 'Done'

/** A very long line (a battle, a big draw) must not fill the screen. */
const MAX_LENGTH = 280

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The same line with the viewer's name spoken as "you" and their possessive as
 * "your". Only that exact name is replaced, so a toast that names another player,
 * a target or a city keeps those words. The line is capitalised afterwards, so
 * "alice used Stonehenge" becomes "You used Stonehenge".
 */
function withoutViewerName(line: string, viewerName: string): string {
  const name = viewerName.trim()
  if (name === '') return line
  const escaped = escapeRegExp(name)
  const replaced = line
    .replace(new RegExp(`\\b${escaped}'s\\b`, 'g'), 'your')
    .replace(new RegExp(`\\b${escaped}\\b`, 'g'), 'you')
    // One card's own line says "<name> was already the start player".
    .replace(/\byou was\b/g, 'you were')
  // Only a line that named the viewer is re-capitalised; unrelated text is left as it is.
  return replaced === line ? line : replaced.replace(/^./, (first) => first.toUpperCase())
}

export function confirmationText(lines: readonly string[], viewerName = ''): string {
  const text = lines
    .map((line) => withoutViewerName(line.trim(), viewerName).trim())
    .filter((line) => line !== '')
    .join(' · ')
  if (text === '') return DONE_TEXT
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text
}
