# Issue #92 — Admin email broadcast (WYSIWYG Markdown)

- **Slug:** `issue-92-admin-email-broadcast`
- **Branch:** `feat/issue-92-admin-email-broadcast`
- **Owner:** orchestrator (DeepSeek V4.1 Flash); implementation by the `coder` role
- **Status:** review-approved — implemented and checked on the branch; PR to open.

## Goal

An admin can, from `/admin`, compose an email in a WYSIWYG Markdown editor with an
editable subject line, tick whether the message should also reach players who
have unsubscribed, and send it to every account that has an email address.
Recipients get a formatted (HTML) email, personalised with their username and
carrying the unsubscribe link.

## Why

Issue #92 (Norwegian): "Jeg ønsker wysiwig editor med markdown for epost utsending
på admin siden slik at jeg kan sende ut epost til alle, med huking på om jeg
ønsker å sende til de som har markert seg som at de ikke ønsker mail lengre."

The old backend really has the logic — `GameAction.sendMailToAll(msg)` — but its
`/admin/mail` endpoint is commented out and there was no UI, so this ports that
method and adds the compose layer. Decisions taken with the owner on 2026-09-20:
the body is Markdown rendered to **HTML** (new dependency `marked`), the subject
is an editable field defaulting to the old wording with the current domain
("Message from cash at playciv.app"), and opted-out players are included only
when the checkbox is ticked.

## Scope

**In:**

- A `POST /api/admin/email/broadcast` route (admin only) taking
  `{ subject, markdown, includeUnsubscribed }` and answering
  `{ sent, skipped }`.
- A `Notifications.broadcast(...)` method that walks `repo.allPlayers()` and
  sends one personalised email per eligible account.
- Markdown rendered to an HTML email body, with the Markdown source as the
  plain-text fallback.
- An "Send email to all players" panel on the admin page: subject input, the
  existing WYSIWYG `MarkdownEditor`, an include-unsubscribed checkbox, a
  confirmation before sending and a success notice with the counts.
- Server and web tests.

**Out:**

- Batching/queueing the sends. They run in-request, one provider call per
  recipient, exactly like the old `sendMailToAll` and the existing game mails.
  A very large account list could hit the Worker's subrequest/CPU limits; that
  is a documented limitation, not fixed here.
- Sanitising the rendered HTML. Only an admin can reach the route, and an admin
  already controls every account, so the content is trusted; recorded in
  `decisions.md`.
- Excluding disabled accounts. Old `sendMailToAll` filtered on `disableEmail`
  only, and the game mails behave the same, so this does too.
- Resend's audience/broadcast product or a per-recipient tracking pixel.

## Reference

- **The ported method:** `old-civ-rest/.../action/GameAction.java:590-599`
  `sendMailToAll(msg)` — every player with `!isDisableEmail()`, subject
  `"Message from cash at playciv.com"`, body `"Hello " + username + "\n" + msg`.
- **The dead endpoint:** `old-civ-rest/.../resource/AdminResource.java:140-147`
  `PUT /admin/mail?msg=` — body commented out, always answered 204. No old-client
  UI existed, so the panel is new.
- **The unsubscribe footer:** `old-civ-rest/.../email/SendEmail.java:62-80` and
  `:121-126` (`sendMessage` appends `UNSUBSCRIBE(playerId)` to the body).
- **The editor:** `packages/web/src/views/MarkdownEditor.tsx` (Milkdown Crepe),
  already used by `TurnPanel.tsx`; reuse it rather than adding a second editor.

## Approach

### Mailer gains an HTML body (`packages/server/src/mail.ts`)

`OutgoingEmail` gets an optional `html?: string`. `createResendMailer` includes
`html` in the Resend JSON payload only when it is set. Extend
`packages/server/test/mail.test.ts` to prove the HTML is forwarded.

### Markdown rendering (`packages/server/src/markdown.ts`, new)

```ts
export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false })
}
export function escapeHtml(value: string): string
```

`escapeHtml` is for the username in the greeting, which sits outside the
Markdown. No sanitising of the rendered Markdown — see Scope and `decisions.md`.

### Broadcast (`packages/server/src/notifications.ts`)

Add to the `Notifications` interface:

```ts
broadcast(options: {
  readonly subject: string
  readonly markdown: string
  readonly includeUnsubscribed: boolean
}): Promise<{ readonly sent: number; readonly skipped: number }>
```

Implementation: walk `repo.allPlayers()`; skip an account with a null/empty
email, and skip `disableEmail === true` unless `includeUnsubscribed`. Per
recipient build:

- `text = "Hello " + username + "\n\n" + markdown + unsubscribe(playerId)`
  (the existing plain-text footer helper);
- `html = "<p>Hello " + escapeHtml(username) + "</p>" + renderMarkdown(markdown)
  + unsubscribeHtml(playerId)`;

then `mailer.send({ to, subject, text, html })`. A send failure is logged and
swallowed (never throws out of the loop), matching `notify`, and counts as
`skipped`. `skipped` therefore means "not sent" (policy skip or failure).

### Route (`packages/server/src/routes/admin.ts`)

`POST /api/admin/email/broadcast`, behind the existing `admin` middleware. Read
`subject` and `markdown` with `requireString`; a missing one is `400 BAD_REQUEST`.
`includeUnsubscribed` must be a boolean when present, defaulting to `false`
(`400` otherwise, as in the user PATCH route's `disabled` check). Answer
`{ sent, skipped }` from `context.notifications.broadcast(...)`.

### Dependency

Add `marked` to `packages/server` (`pnpm add marked --filter @civ/server`). It is
pure JS with no Node built-ins, so it runs on Cloudflare Workers too.

### Client API (`packages/web/src/lib/api.ts`)

```ts
broadcastEmail: (subject: string, markdown: string, includeUnsubscribed: boolean) =>
  post<{ readonly sent: number; readonly skipped: number }>(
    '/api/admin/email/broadcast',
    { subject, markdown, includeUnsubscribed },
  ),
```

### Admin view (`packages/web/src/views/AdminView.tsx`)

A new `<section className="panel">` "Send email to all players" below the users
list: a subject input defaulting to `Message from cash at playciv.app`, the
`MarkdownEditor` for the body, a checkbox "Also send to players who have
unsubscribed", and a Send button. Confirm with `window.confirm` before sending;
on success show `Sent to N players; M skipped.` and clear the body. Disable the
button while sending, or when the subject or body is blank.

Add an optional `editorComponent` prop defaulting to `MarkdownEditor` — the same
pattern `TurnPanel.tsx` uses — so the test can inject a plain textarea.

### Tests

- `packages/server/test/admin-email-broadcast.test.ts` (new): a `FakeMailer` and
  `createTestApp`; register several accounts (remember `securityAnswer:
  'writing'`); promote one to admin via `repo.updatePlayer`; flip another's
  `disableEmail` through the stop route. Then assert:
  - the default broadcast reaches only opted-in accounts, with the greeting, the
    rendered HTML (`<strong>` for `**bold**`), the plain-text fallback and the
    unsubscribe link;
  - `includeUnsubscribed: true` also reaches the opted-out account;
  - a non-admin gets 403, missing subject/markdown gets 400, a non-boolean
    `includeUnsubscribed` gets 400;
  - a username containing HTML is escaped in the HTML greeting.
- `packages/web/src/views/AdminView.test.tsx` (new): mock `../lib/api.js`, inject
  a fake editor, assert Send calls `api.broadcastEmail(subject, body, include)`
  and shows the counts; assert it stays disabled with a blank subject or body.
- `packages/server/test/mail.test.ts`: HTML is forwarded to Resend.

### Docs

- `decisions.md` (append) and `README.md` ("Deliberate improvements"): the old
  broadcast method was unreachable; this exposes it with an HTML body rendered
  from Markdown by `marked`, an editable subject, and an explicit opt-in to mail
  unsubscribed players. Note the untrusted-HTML/sanitising question and the
  in-request volume limit.
- `state.md`, `task-board.md`.

## Claimed paths

- `packages/server/src/mail.ts`
- `packages/server/src/markdown.ts` (new)
- `packages/server/src/notifications.ts`
- `packages/server/src/routes/admin.ts`
- `packages/server/package.json`, `pnpm-lock.yaml` (`marked` only)
- `packages/server/test/mail.test.ts`
- `packages/server/test/admin-email-broadcast.test.ts` (new)
- `packages/web/src/lib/api.ts` (`broadcastEmail` only)
- `packages/web/src/views/AdminView.tsx`
- `packages/web/src/views/AdminView.test.tsx` (new)
- `docs/agents/tasks/issue-92-admin-email-broadcast.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`

## Acceptance criteria

- [x] An admin can send a subject and a Markdown body to every player with an
      email; a non-admin gets 403.
- [x] Recipients receive HTML (e.g. `**bold**` becomes `<strong>bold</strong>`)
      with the Markdown source as the plain-text fallback.
- [x] Opted-out players receive it only when the checkbox is ticked.
- [x] Each mail keeps the `Hello <username>` greeting and the unsubscribe link.
- [x] Server tests cover the filtering, the validation and the HTML; the web
      test covers the form.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: not applicable — the route is admin-only and no game
      projection changes.
- [ ] Verified in the browser: compose and send to a test account (HTML arrives),
      then tick the checkbox and confirm an opted-out account receives it. — no
      browser was connected in the coding session; the route is exercised
      end-to-end through Hono (`app.request`) with a fake mailer, and the form by
      `AdminView.test.tsx`. Delivery itself could not be observed (local mailer
      is a no-op without `RESEND_API_KEY`).

## Open questions

None blocking. The owner chose HTML rendering and an editable subject on
2026-09-20, and corrected the domain in the default subject to `playciv.app`.
