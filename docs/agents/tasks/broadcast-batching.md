# Admin broadcast: batching and honest results

- **Slug:** `broadcast-batching`
- **Branch:** `fix/broadcast-batching`
- **Owner:** orchestrator (Claude); implementation by the `coder` role
- **Status:** claimed

## Goal

The admin email broadcast reaches every eligible account in one run, tells the
admin exactly what happened, and can be resumed without mailing anyone twice.

## Why

The first real broadcast (2026-10-03, 555 accounts) printed
"Sent to 49 players; 506 skipped." Evidence: Cloudflare's Workers log has
`Broadcast email to <id> failed` for the rest, Resend's log shows only one
rejected request (422) and 61 accepted ones that day. So about 500 sends never
left the Worker. Cause: `Notifications.broadcast` makes one `fetch` to Resend per
recipient, in one request, and the Worker is on the free plan, which allows 50
subrequests per invocation (49 sends plus the database read). The failures were
swallowed and counted as `skipped`, and the logged error carried no message
(`console.error(text, error)` prints only the stack on Workers), so nothing said
why.

`decisions.md` (issue #92) and README already list this as a known limitation.
This task fixes it.

The Resend account is on the free plan: 100 mails per day, 3000 per month.
61 were used on 2026-10-03, so a full list cannot go out in one day on that
plan. The design must therefore also allow a resumed, partial run.

## Scope

**In:**

1. **Batch sending.** `Mailer` gets an optional `sendBatch(emails)`. The Resend
   mailer implements it with `POST https://api.resend.com/emails/batch`, a JSON
   array of at most 100 emails, each with its own `to`, `subject`, `text` and
   `html` (one personalised mail per recipient: the greeting and unsubscribe link
   differ, so one mail with many recipients is not an option). A longer timeout
   than the single send (15 s). If a mailer has no `sendBatch` (test fakes,
   `noopMailer`), `broadcast` falls back to calling `send` per recipient, so every
   existing test double still works.
2. **A typed provider error.** Export `MailError` from `mail.ts` with `status`
   and `detail`. `send` and `sendBatch` throw it for a non-2xx answer. The
   message text of `send` stays exactly as today (`Resend rejected the email
   (<status>): <detail>`), because tests match on it.
3. **`broadcast` rewritten** in `notifications.ts`:
   - Render the Markdown to HTML **once**, outside the per-recipient loop; only
     the greeting and unsubscribe parts differ per mail. (The Worker's CPU time
     on the free plan is small.)
   - Walk `repo.allPlayers()` once and classify each account: no address,
     unsubscribed (unless `includeUnsubscribed`), excluded (its address is in the
     new `exclude` list, compared case-insensitively and trimmed), address not
     valid-looking (a simple `^[^\s@]+@[^\s@]+\.[^\s@]+$` check; reported as a
     failure with the reason, no provider call), or eligible.
   - New option `limit` (positive integer, optional): attempt at most that many
     eligible accounts, in the order they come, and count the rest as `deferred`.
   - Send eligible accounts in chunks of 100 through `sendBatch`.
   - A **provider request budget** of 40 calls per broadcast (the Worker allows
     50 subrequests in total, and the database read and the auth check use some).
   - On a `MailError` with status 429: stop, record the provider's message as
     `stopReason`, and count everything not yet sent as `deferred`.
   - On another 4xx (a 422 for one bad address makes Resend reject the whole
     batch): split the chunk in two and retry each half, down to a single
     address, which is recorded in `failed` with the provider's message. Every
     retry spends budget; when the budget runs out, stop with `stopReason` and
     count the rest as `deferred`.
   - On a 5xx or a thrown network/timeout error: stop with `stopReason`, rest
     `deferred`. (A timed-out batch may in fact have been accepted; say so in the
     `stopReason`, because it is the one case where a retry could duplicate.)
   - Log failures with the message in the string itself:
     `console.error(\`Broadcast batch failed: \${message}\`)`, never as a second
     argument. Never log email addresses in bulk; per-failure lines may include
     the player id, not the address.
4. **A result that explains itself.** Replace `{ sent, skipped }` with:

   ```ts
   {
     sent: number
     sentTo: string[]                       // addresses accepted this run, for the next run's exclude list
     skipped: { noAddress: number; unsubscribed: number; excluded: number }
     failed: { email: string; reason: string }[]
     deferred: number                       // eligible but not attempted (limit, quota, budget, stop)
     stopReason: string | null
   }
   ```
5. **Route.** `POST /api/admin/email/broadcast` accepts optional
   `exclude: string[]` (at most 5000 entries, each a string) and
   `limit: number` (integer, 1 to 5000). Wrong types answer 400
   `BAD_REQUEST` like the existing `includeUnsubscribed` check.
6. **Admin page.** Under the existing composer, add: a "Skip these addresses"
   textarea (addresses separated by newlines, commas or spaces), and an optional
   "Send to at most" number field. After a send, show a readable summary: sent,
   skipped by reason, failed (with each address and reason), deferred, and the
   stop reason when there is one. Show the addresses sent in this run in a
   read-only textarea with a short hint to paste them into the skip box on the
   next run. Keep the existing confirmation before sending, and make it mention
   the limit when one is set.
7. **Tests** (server and web), listed below.
8. **Docs.** Append to `decisions.md`; update the README paragraph "The admin
   broadcast is reachable"; add a line to `state.md`. Remove the "known
   limitation" wording that this fixes.

**Out:**

- Remembering in the database which accounts got which broadcast. The exclude list
  and `sentTo` do that by hand; a table and migration is a separate task if this
  proves clumsy.
- Resend's own Audiences/Broadcasts product.
- Changing any game mail (`notify`), which stays one `send` per recipient.
- Upgrading plans, secrets or `wrangler.jsonc`.

## Paths

- `packages/server/src/mail.ts`
- `packages/server/src/notifications.ts`
- `packages/server/src/routes/admin.ts`
- `packages/server/test/mail.test.ts`
- `packages/server/test/admin-email-broadcast.test.ts`
- `packages/server/test/notifications.test.ts` (only if it covers `broadcast`)
- `packages/web/src/lib/api.ts` (only `broadcastEmail` and its result type)
- `packages/web/src/views/AdminView.tsx`, `AdminView.test.tsx`, and its CSS if any
- `docs/agents/decisions.md`, `docs/agents/state.md`, `README.md`

## Reference

- Old behaviour: `GameAction.sendMailToAll` in `old-civ-rest` (one send per
  opted-in player, no result). The reachable version is issue #92; see
  `docs/agents/tasks/issue-92-admin-email-broadcast.md` and `decisions.md`.
- Resend batch API: up to 100 emails per request; no attachments; the whole
  request is rejected when one email fails validation.

## Tests that must exist

Server:

- 555 eligible accounts produce **at most 6 provider requests** (not 555), in
  chunks of at most 100, and `sent` is 555.
- A mailer with no `sendBatch` still sends every mail through `send`.
- `exclude` removes matching addresses (case-insensitive, trimmed) and counts
  them under `skipped.excluded`; they are never in `sentTo`.
- `limit` stops after N eligible accounts; the rest are `deferred`.
- One bad address in a 100-chunk (provider answers 422 for any batch containing
  it): everyone else is sent, the bad one is in `failed` with the provider's
  message, and the number of provider requests stays within the budget.
- An address that fails the validity check is in `failed` and never reaches the
  provider.
- A 429 stops the run, sets `stopReason`, and the unsent accounts are `deferred`.
- A thrown network error stops the run with a `stopReason` and does not throw out
  of `broadcast`.
- No-address and unsubscribed accounts are counted under their own keys; the
  unsubscribed ones are included when `includeUnsubscribed` is true.
- Each mail still has its own username greeting and its own unsubscribe link, and
  the greeting is HTML-escaped (the existing tests for this must pass unchanged
  or be moved, not weakened).
- The route answers 400 for a wrong `exclude` or `limit`, 403 for a non-admin as
  before, and returns the new result shape.
- `mail.test.ts`: `sendBatch` posts a JSON array to `/emails/batch` with the right
  headers; a 422 throws `MailError` with `status` 422 and the body in `detail`;
  `send`'s existing messages are unchanged.

Web:

- The skip box and limit field are sent to the API in the right shape (the
  addresses split on newlines, commas and spaces, trimmed, empties removed).
- The summary shows each count, each failed address with its reason, the stop
  reason, and the `sentTo` addresses in the read-only box.

## Done when

- `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- The read-only reviewer's last round has nothing above a nit.
- A short note in `decisions.md` records: batching is the fix for the 50
  subrequest limit; the 40 request budget; the bisect on a 4xx; that the Resend
  free plan's 100 per day still caps a single day.
