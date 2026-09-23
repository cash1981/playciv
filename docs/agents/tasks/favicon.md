# Bring back the old site icon

- **Slug:** `favicon`
- **Branch:** `feat/favicon`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

The browser tab for the current app shows no site icon. The old AngularJS client
did, and that icon — a Civilization coin — should come back, so the tab, the
bookmark and the phone home-screen shortcut identify playciv again.

## Why

The human asked directly: *"Kan du se i den gamle old-civ-web, den hadde ikon,
kan du legge til den samme i nåværende frontend app"* — look in `old-civ-web`,
it had an icon, add the same to the current frontend. The React rewrite
(`packages/web`) never carried the icon over; `index.html` has no icon link and
`public/` has no icon file.

## Scope

**In:**

- Copy `old-civ-web/app/favicon.ico` into `packages/web/public/favicon.ico`.
- Copy the old apple-touch icon (`old-civ-web/app/apple-touch-icon.png`, byte for
  byte the same as `old-civ-web/app/images/icons/coin.png` the old `index.html`
  actually referenced) into `packages/web/public/apple-touch-icon.png`.
- Reference both from `packages/web/index.html`.

**Out:**

- No new artwork is drawn or resized; the exact old files ship.
- The old `?v=2` cache-buster is not carried over — Vite fingerprints the build
  and the query string existed to bust an old CDN cache, not to do anything for
  a fresh deploy.
- Nothing in the Worker's static-asset config changes: `packages/web/public` is
  copied into `dist` by Vite and `dist` is what the Worker serves.

## Reference

- `old-civ-web/app/index.html` head:
  `<link rel="shortcut icon" href="favicon.ico?v=2" />` and
  `<link rel="apple-touch-icon" href="images/icons/coin.png">`.
- `old-civ-web/app/favicon.ico` (32038 bytes) and
  `old-civ-web/app/apple-touch-icon.png` /
  `old-civ-web/app/images/icons/coin.png` (both 19363 bytes, identical SHA-256)
  are the source files. `old-civ-web/` is gitignored reference material, so the
  files are copied into the repo, not read from it at build time.

## Approach

- `packages/web/public/favicon.ico` — new, copied from the old client.
- `packages/web/public/apple-touch-icon.png` — new, copied from the old client.
- `packages/web/index.html` — two `<link>` tags in `<head>`, `rel="icon"` (the
  modern spelling of the old `shortcut icon`) and `rel="apple-touch-icon"`.
  Vite serves `public/` at the site root, so `/favicon.ico` and
  `/apple-touch-icon.png` are the URLs.

## Claimed paths

- `packages/web/index.html`
- `packages/web/public/favicon.ico` (new)
- `packages/web/public/apple-touch-icon.png` (new)
- `docs/agents/tasks/favicon.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] `packages/web/public/favicon.ico` is byte-identical to
      `old-civ-web/app/favicon.ico`.
- [ ] `packages/web/public/apple-touch-icon.png` is byte-identical to the old
      `apple-touch-icon.png` / `images/icons/coin.png`.
- [ ] `packages/web/index.html` links both, at the site root.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] The built `dist/` contains both files at its root.
- [ ] Verified in the browser: the running dev server answers both URLs with the
      right content type and the tab shows the icon.
- [ ] Hidden information: no game data is projected or touched; nothing to leak.
