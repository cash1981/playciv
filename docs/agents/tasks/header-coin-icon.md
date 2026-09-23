# Coin icon in the top bar, linked to the home page

- **Slug:** `header-coin-icon`
- **Branch:** `feat/header-coin-icon`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

The site icon the browser tab already shows — the gold Civilization coin — also
appears in the top bar, to the left of the "Civilization playciv" wordmark, and
clicking it goes to the home page (`/`), the same place the wordmark already
goes.

## Why

The human asked, in Norwegian: *"Kan jeg få det coin ikonet vi har som favicon
oppe til venstre foran Civlization. Den skal også være en lenke til
hovedsiden."* The wordmark in `Navigation.tsx` is already an anchor to `/`; the
coin is the missing visual mark at the far left of the bar.

## Scope

**In:**

- Show the existing favicon/coin artwork as an image inside the existing
  `.brand` anchor, before the wordmark.
- Size and align it so it reads as part of the brand at the bar's font scale.

**Out:**

- No new artwork, no re-encoding of the icon files: the image reuses the coin
  already in `public/`.
- No change to where the brand links or how navigation works; the anchor
  already points at `/`.
- No change to the favicon links in `index.html` — those already ship.

## Reference

Not an FFG game rule and not present in the old clients: the old AngularJS
`old-civ-web/app/index.html` had only the tab icon, no header coin. This is a
new presentation request from the human, so there is nothing to port; the
existing asset is reused as-is.

## Approach

- `packages/web/src/views/Navigation.tsx`: add an `<img>` as the first child of
  the `.brand` anchor, `src="/favicon.ico"`, empty `alt` (decorative — the
  adjacent text already names the link), class `brand-icon`.
- `packages/web/src/styles.css`: a `.brand-icon` rule giving it a square
  `1.25rem` box and `align-self: center`, and adjust `.brand` to
  `align-items: center` so the icon and wordmark sit on the same line cleanly.
- `packages/web/src/views/Navigation.test.tsx`: assert the brand anchor goes to
  `/` and contains an image pointing at `/favicon.ico`.

## Claimed paths

- `packages/web/src/views/Navigation.tsx`
- `packages/web/src/views/Navigation.test.tsx`
- `packages/web/src/styles.css`
- `docs/agents/tasks/header-coin-icon.md`

## Acceptance criteria

- [ ] The top bar shows the coin to the left of "Civilization".
- [ ] The coin is inside the brand anchor, whose `href` is `/`.
- [ ] The image has empty `alt`, so screen readers do not announce it twice.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: asset-only plus presentational markup; no engine,
      server, route or projection touched, so nothing can leak.
- [ ] Verified in the browser: the coin renders at the left of the bar and the
      wordmark still links home.

## Open questions

None.
