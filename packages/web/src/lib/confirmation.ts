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

/**
 * The same line with the actor named as "you" and their possessive as "your". Only
 * the actor at the start of the line (after "System: ") is changed, plus the one
 * play-card line that names the actor again mid-sentence. A different player or a
 * card name that happens to contain the viewer's name is left alone; a name is
 * matched as literal text, so an accented or punctuated username is safe.
 */
function withoutViewerName(line: string, viewerName: string): string {
  const name = viewerName.trim()
  if (name === '') return line
  const prefix = line.startsWith('System: ') ? 'System: ' : ''
  const rest = line.slice(prefix.length)
  const possessive = `${name}'s`
  const plain = `${name} `
  let text = line
  let named = false
  if (rest.startsWith(possessive)) {
    text = `${prefix}your${rest.slice(possessive.length)}`
    named = true
  } else if (rest.startsWith(plain)) {
    text = `${prefix}you ${rest.slice(plain.length)}`
    named = true
  }
  if (!named) return line
  // A played Great Person line says the actor's name again after a comma or in
  // the clockwise note. These are the only actor references outside the start.
  text = text
    .replaceAll(`, but ${name} was`, ', but you were')
    .replaceAll(`from ${name})`, 'from you)')
  return text.replace(/^./, (first) => first.toUpperCase())
}

export function confirmationText(lines: readonly string[], viewerName = ''): string {
  const text = lines
    .map((line) => withoutViewerName(line.trim(), viewerName).trim())
    .filter((line) => line !== '')
    .join(' · ')
  if (text === '') return DONE_TEXT
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text
}
