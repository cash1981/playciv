# Buy Me a Coffee button in the site-wide footer

- **Slug:** `buymeacoffee-footer`
- **Branch:** `feat/buymeacoffee-footer`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

The site footer — which renders under every screen — carries a "Buy me a
coffee" button next to the existing PayPal donate button, so a visitor who
prefers Buy Me a Coffee can support the project the same way the PayPal button
already allows.

## Why

The human asked directly, in Norwegian: *"Kan du legge til denne 'buy me a
coffee' koden ved siden av donate knappen til paypal i footer så den kommer i
alle sider"*, and supplied the exact button markup to use. Issue #77 put the
footer on every page (copyright, Apache 2.0 license and the PayPal donate
button); this adds one more donation option beside it. There is no counterpart
in the old system — the old footer had PayPal and Patreon only — so this is a
new, human-specified addition, not a port.

## Scope

**In:**

- The exact button the human supplied: an `<a>` to
  `https://www.buymeacoffee.com/cash1981` wrapping the
  `img.buymeacoffee.com/button-api/…slug=cash1981…` image.
- Placement beside the PayPal form, in the footer's right-hand support area, so
  it shows on every page the footer already covers.
- Styles so the two buttons sit together and stay usable in both the light and
  dark themes and on narrow screens.

**Out:**

- **No change to the PayPal button** — the encrypted hosted button stays
  byte-for-byte as issue #77 left it.
- **No third-party script** — Buy Me a Coffee also offers a JavaScript widget;
  only the plain image link the human sent is added, matching issue #77's
  "no third-party script" stance for Patreon.
- **No other footer changes** — copyright, license and layout outside the
  donation row are untouched.

## Reference

- `packages/web/src/views/Footer.tsx` — the footer issue #77 added.
- `docs/agents/tasks/issue-77-footer.md` and `decisions.md` (2026-09-19) — why
  the footer exists and why Patreon/third-party scripts were dropped.
- The human's markup:
  `<a href="https://www.buymeacoffee.com/cash1981"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=cash1981&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" /></a>`

## Approach

- `Footer.tsx`: wrap the existing `<form class="site-footer-donate">` and the
  new `<a>` in a `.site-footer-support` flex container. The anchor keeps the
  supplied `href` and image `src` verbatim; add `target="_blank"
  rel="noopener noreferrer"` (the convention everywhere else in the client for
  external links) and an `alt` of `Buy me a coffee` (the supplied markup has
  none, and an image-only link needs accessible text).
- `styles.css`: add `.site-footer-support` (flex row, gap, wraps) and a small
  `.site-footer-coffee img` rule so the external button does not stretch when
  the footer wraps on a narrow screen.
- `Footer.test.tsx`: assert the Buy Me a Coffee link and image are present and
  point at `cash1981`, so a removal fails the test.

## Claimed paths

- `packages/web/src/views/Footer.tsx`
- `packages/web/src/views/Footer.test.tsx`
- `packages/web/src/styles.css`
- `docs/agents/tasks/buymeacoffee-footer.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`
- `README.md`

## Acceptance criteria

- [x] The footer shows the Buy Me a Coffee button beside the PayPal donate
      button; the styles follow the footer's existing flex/theme rules. The
      light/dark visual pass is left to the human (no browser here).
- [x] The link points at `https://www.buymeacoffee.com/cash1981` and the image
      at the supplied `img.buymeacoffee.com` URL with `slug=cash1981`.
- [x] The PayPal form is unchanged from issue #77.
- [x] No third-party script is added; the button is a plain image link.
- [x] A test fails if the Buy Me a Coffee link or image is removed
      (`Footer.test.tsx`).
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
      (429 engine / 173 server / 73 web, one more web test than before).
- [x] Hidden information: the footer is static markup and reads no game state,
      so nothing can leak; no projection changes.
- [x] Rendered the real `Footer` in jsdom, so the button and its placement are
      covered by the test above. **No desktop browser is connected in this
      session**, so the visual pass (both themes, the footer wrapping on a
      narrow screen) is left to the human testing the PR.

## Open questions

- **The supplied code had no `target`, `rel` or `alt`.** Following the client's
  existing convention, the link opens in a new tab with
  `rel="noopener noreferrer"` and the image carries `alt="Buy me a coffee"`.
  These are small, reversible additions; noted in `decisions.md`.
