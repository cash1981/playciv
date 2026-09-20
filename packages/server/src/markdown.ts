/**
 * Markdown to HTML for outgoing email (issue #92). The old system only ever
 * sent plain text through SendGrid; the admin broadcast renders a composed body
 * instead. `marked` is pure JS with no Node built-ins, so it runs unchanged on
 * Cloudflare Workers.
 */

import { marked } from 'marked'

/**
 * Renders the admin's broadcast body. Deliberately not sanitised: only an admin
 * can reach the route, and an admin already controls every account, so the
 * content is trusted. Recorded in `decisions.md`.
 */
export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false })
}

/**
 * Escapes the parts of the HTML mail that sit outside the admin's Markdown.
 * Today that is only the recipient's username, which an admin may have set to
 * raw HTML through the user editor.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
