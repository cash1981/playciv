# Issue #77 — Site-wide footer with copyright, license and donation

- **Slug:** `issue-77-footer`
- **Branch:** `feat/issue-77-footer`
- **Owner:** OpenCode (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

Every page of the client shows a footer with the project copyright, a link to
the Apache 2.0 license and the old PayPal donate button, so a visitor can see
the licensing and support the project from anywhere in the app — signed in or
not, on the lobby, a game, the FAQ, the About page or the highscore.

## Why

The issue: *"Look at the old frontend and add copyright / apache license and
donation footer on all pages"* (issue #77, labels *Nice to have* +
*enhancement*). The old AngularJS client had this in
`old-civ-web/app/index.html` as a single `<footer class="footer">` outside the
routed view, so it appeared on every screen. The rewrite never ported it, yet
the game-ended email already tells players to "find the link at the bottom of
the site" (`packages/server/src/notifications.ts`, `gameEnded`), so the
donation link is referenced before it exists.

## Scope

**In:**

- A `Footer` component rendered on every screen the app can show.
- The copyright line, the Apache 2.0 link and the PayPal donation button.
- The **exact** old PayPal form, including the encrypted hosted-button value,
  so it is the same donation to the same account (the human chose this over a
  new integration; see Open questions).
- Footer styles that work in both the light and dark themes.

**Out:**

- **Patreon.** The old footer also had a "Become a Patron!" link plus Patreon's
  `becomePatronButton.bundle.js`. The human chose PayPal only, so neither the
  link nor the third-party script is ported.
- **Google Analytics**, also in `old-civ-web/app/index.html` — not part of this
  issue.
- **The tournament page** and its PayPal wording — the tournament feature is
  deferred (`state.md`).
- **The About page** — it already carries the license and FFG disclaimer
  (issue #35); the footer links to the license, it does not duplicate the page.
- **Email/contact details** — unchanged.

## Reference

- `old-civ-web/app/index.html` lines 49–67: the footer markup.
- `old-civ-web/app/styles/main.css`: `.footer` — grey text (`#777`) with a top
  border.
- The donation is the legacy encrypted PayPal hosted button
  (`cmd=_s-xclick` + `encrypted=…PKCS7…`), not a value we can re-derive. It is
  copied verbatim from the old `index.html`.

## Approach

- New `packages/web/src/views/Footer.tsx`: one `<footer class="site-footer">`
  with the copyright/license sentence and a `<form>` posting to
  `https://www.paypal.com/cgi-bin/webscr` (`method="post"`, `target="_top"`)
  carrying the old hidden `cmd` and `encrypted` inputs and the donate image.
- `App.tsx` renders `<Footer />` inside each `div.app` it returns, so it sits
  under every screen the shell can select (lobby, admin, game, faq, about,
  highscore, and the signed-out landing/login).
- `styles.css`: a `.site-footer` rule (top border, muted colour, spacing,
  right-aligned donate form; stacks on narrow screens).
- External links use `target="_blank" rel="noopener noreferrer"`, matching the
  rest of the client.

## Claimed paths

- `packages/web/src/App.tsx`
- `packages/web/src/views/Footer.tsx` (new)
- `packages/web/src/views/Footer.test.tsx` (new)
- `packages/web/src/styles.css`
- `docs/agents/tasks/issue-77-footer.md` (new)
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`
- `README.md`

## Acceptance criteria

- [x] The footer renders on every screen: lobby/landing (signed out and in),
      login, admin, game, FAQ, About and highscore.
- [x] The copyright line reads "Copyright © 2015–2026 by Shervin Asgari. All
      rights reserved." and links "Apache 2.0 License" to
      `https://www.apache.org/licenses/LICENSE-2.0`.
- [x] The PayPal form posts to the old endpoint with the old `cmd` and
      `encrypted` values — byte-for-byte the same donation as the old client
      (verified by comparison against `old-civ-web/app/index.html`).
- [x] No Patreon link or third-party Patreon script is added.
- [x] A test fails if the footer (or its donation form fields) is removed:
      `packages/web/src/views/Footer.test.tsx`.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
      (401 engine / 123 server / 39 web).
- [x] No hidden information is touched: the footer is static markup and reads
      no game state.
- [x] Rendered the real `App` in jsdom for `/about` and `/faq`; both show the
      footer once the page renders. **A desktop browser was not connected in
      this session**, so the visual pass (both themes, bottom of the lobby and
      a game) is left to the human testing the PR.

## Open questions

Resolved with the human before starting:

- **PayPal:** reuse the exact old encrypted button (chosen) rather than a new
  donate link or the Donate SDK.
- **Patreon:** drop it; PayPal only (chosen).
- **Copyright years:** `2015–2026` (chosen) rather than the old `2015–2021`.

## Deliberate differences from the old client

Recorded in `decisions.md`:

- Patreon is not ported (human decision).
- The donation form is no longer floated with Bootstrap's `pull-right`; it is
  laid out with the footer's own flex rule so it works in the React app.
