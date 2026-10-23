/**
 * The text of the green toast after an action went through.
 *
 * The lines come from the server's confirmation route, which answers with the viewer's
 * own private log text and nothing of anyone else's. With nothing to say it is a
 * plain "Done".
 */

export const DONE_TEXT = 'Done'

/** A very long line (a battle, a big draw) must not fill the screen. */
const MAX_LENGTH = 280

export function confirmationText(lines: readonly string[]): string {
  const text = lines.filter((line) => line.trim() !== '').join(' · ')
  if (text === '') return DONE_TEXT
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text
}
