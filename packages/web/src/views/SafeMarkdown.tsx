/**
 * Renders a chat or order message as Markdown without ever producing markup we
 * did not choose. react-markdown builds React elements and does not parse raw
 * HTML (no rehype-raw), so `<script>` and `<img onerror>` arrive as plain text.
 * Nothing here uses `dangerouslySetInnerHTML`.
 */

import ReactMarkdown from 'react-markdown'

/** The only schemes a link may use. Anything else (javascript:, data:, ...) loses its href. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** Returns the url when it is absolute with an allowed scheme, else an empty string. */
export function safeUrl(url: string): string {
  try {
    return ALLOWED_SCHEMES.has(new URL(url).protocol) ? url : ''
  } catch {
    // Relative or malformed: a message has no page of its own to be relative to
    return ''
  }
}

interface Props {
  readonly markdown: string
}

export function SafeMarkdown({ markdown }: Props): React.JSX.Element {
  return (
    <div className="safe-markdown">
      <ReactMarkdown
        urlTransform={safeUrl}
        components={{
          a: ({ href, children }) =>
            href === undefined || href === '' ? (
              <span>{children}</span>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          // A remote image would let any author make every reader's browser
          // fetch a url of their choosing, so only the alt text is shown.
          img: ({ alt }) => <span>{alt ?? ''}</span>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
