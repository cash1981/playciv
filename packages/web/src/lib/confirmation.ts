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
 * The same line with the actor named as "you" and their possessive as "your". Only
 * the actor at the start of the line (after a "System: " or "Turn N - " label) is
 * changed, plus the other actor references in the lines that name the actor again
 * ("played ... but you were", "removed ... from you", "added back ... to you"). A
 * different player or a card name that happens to contain the viewer's name is
 * left alone; a name is matched as literal text, so an accented or punctuated
 * username is safe.
 */
function withoutViewerName(line: string, viewerName: string): string {
  const name = viewerName.trim()
  if (name === '') return line
  // A phase line has "Turn N - " before the actor, and an undo line "System: ".
  const prefix = /^(?:(?:System: )|(?:Turn \d+ - ))*/.exec(line)?.[0] ?? ''
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
  // The played Great Person line names the actor after a comma, and the undo
  // templates name the actor after "from" or "to". No other line does. The
  // lookahead keeps "Alice-Bob" and "Alice's" from being read as "Alice".
  const escaped = escapeRegExp(name)
  const afterName = `(?![\\p{L}\\p{N}_'-])`
  text = text
    .replaceAll(`, but ${name} was`, ', but you were')
    .replace(new RegExp(`from ${escaped}${afterName}`, 'gu'), 'from you')
    .replace(new RegExp(`to ${escaped}${afterName}`, 'gu'), 'to you')
    // The log writes third-person verbs; "you" takes the base form.
    .replace(/\byou has\b/g, 'you have')
    .replace(/\byou is\b/g, 'you are')
    .replace(/\byou was\b/g, 'you were')
    .replace(/\byou plays\b/g, 'you play')
    .replace(/\byou reveals\b/g, 'you reveal')
    .replace(/\byou moves\b/g, 'you move')
  return capitalizeLine(text, prefix)
}

/** Capitalise the start of the line, or the start after a "System: " prefix. */
function capitalizeLine(text: string, prefix: string): string {
  if (prefix === '') return text.replace(/^./, (first) => first.toUpperCase())
  const body = text.slice(prefix.length)
  return `${prefix}${body.replace(/^./, (first) => first.toUpperCase())}`
}

export function confirmationText(lines: readonly string[], viewerName = ''): string {
  const text = lines
    .map((line) => withoutViewerName(line.trim(), viewerName).trim())
    .filter((line) => line !== '')
    .join(' · ')
  if (text === '') return DONE_TEXT
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text
}
