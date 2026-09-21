# Colour the front page's Open and Join buttons

- **Slug:** `front-page-join-colors`
- **Branch:** `feat/front-page-join-colors`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress (round 2 — Join green)

## Goal

On the front page's **Active games** table, the two actions a signed-in player
can take on a row — **Open** a game they are already in, and **Join** a game
with a free seat — are both drawn as plain grey default buttons. They should be
coloured so they stand out from the table and from the disabled **Full**
button: **Open** in the teal the old front page used, and **Join** in green.

## Why

The human asked directly, in Norwegian: *"Hvis du ser på old-civ-web så ser du
at forsiden hadde farger på join knappene. Det er vanskelig å 'Open' og 'join'
idag. Kan du gi samme farge som den forrige versjonen, og en farge i dark theme
som passer."*, then followed up with *"I want green color for join"*.

`old-civ-web/app/views/list.html` rendered its Join action as
`<a class="btn btn-info">Join</a>`; Bootstrap 3's `.btn-info` is a teal
(`#5bc0de` background, `#46b8da` border, white text). The rewrite's list
(`GameList.tsx`) renders `Open` / `Join` as `className="small"`, i.e. the
unstyled grey default. The first round restored the old teal for both; the
human then asked for green on **Join**, so the two actions now differ: Open
keeps the old teal, Join is Bootstrap's `.btn-success` green, and each has a
dimmer shade for the dark theme, which is the client default.

## Scope

**In:**

- Two new button variants in `styles.css`, after `primary` and `danger`:
  - `info` — Bootstrap's `.btn-info` teal in the light theme, a dimmer teal in
    dark. Used by **Open**.
  - `success` — Bootstrap's `.btn-success` green in the light theme, a dimmer
    green in dark. Used by **Join**.
- The `Open` action gets `info`, the `Join` action gets `success`
  (`className="small info"` / `"small success"`).
- A `GameList.test.tsx` case that fails if either action loses its variant.

**Out:**

- **The disabled `Full` button stays plain grey** on purpose: it is a
  non-action and should not compete with the two that do something.
- **No size or layout change** — the buttons keep `.small`; the only change is
  colour.
- **Nothing else on the front page** — the search box, tabs, sorting, pager and
  the rest of the table are untouched.
- **Writing the light/dark values into the JSX or a per-button inline style** is
  out: the palette lives in `styles.css` with the other theme variables.

## Reference

- `old-civ-web/app/views/list.html` line 131–135 — the old
  `btn btn-info` Join link (active games table).
- `old-civ-web/bower_components/bootstrap/dist/css/bootstrap.css` lines
  2895–2908 — `.btn-success` and its `:hover`/`:focus` state (green).
  Lines 2940–2953 — `.btn-info` (teal).
- `packages/web/src/styles.css` — the `:root` / `:root[data-theme='light']`
  variable blocks and the `button`, `button.primary`, `button.danger`,
  `button.small` rules.
- `packages/web/src/views/GameList.tsx` — `actionCell`, which decides between
  Open, Join, Full and "Sign in to join".

## Approach

- `styles.css`: add `--info*` and `--success*` variables to the dark `:root` and
  to `:root[data-theme='light']`. Light copies Bootstrap exactly
  (info `#5bc0de` / `#46b8da` / white, hover `#31b0d5` / `#269abc`; success
  `#5cb85c` / `#4cae4c` / white, hover `#449d44` / `#398439`); dark uses a
  dimmer shade of each tuned to the dark panels. Add `button.info` and
  `button.success`, each with a `:hover:not(:disabled)` rule that keeps its own
  fill, after the `danger` rule and before `button.small`, so they compose with
  `.small` and beat the generic `button:hover` accent border.
- `GameList.tsx`: `Open` becomes `className="small info"`, `Join` becomes
  `className="small success"`. `Full` and the `muted` "Sign in to join" text are
  unchanged.
- `GameList.test.tsx`: one new case asserting `Open` has `info`, `Join` has
  `success`, and `Full` has neither.

## Claimed paths

- `packages/web/src/styles.css`
- `packages/web/src/views/GameList.tsx`
- `packages/web/src/views/GameList.test.tsx`
- `docs/agents/tasks/front-page-join-colors.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] A signed-in player's `Open` button renders with the `info` variant and
      `Join` with the `success` variant; `Full` stays the grey default.
- [ ] Light theme uses Bootstrap's `.btn-info` teal for Open and `.btn-success`
      green for Join; dark theme uses a dimmer shade of each that reads against
      `--panel-2`.
- [ ] Each variant's hover state keeps its own background/border instead of the
      generic accent border.
- [ ] A test fails if `Open` or `Join` loses its variant.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: the buttons render only `game.id`, already public in
      the list, and read no hand or private state; no projection changes, so
      nothing can leak.
- [ ] Verified in the browser: both themes inspected on a live front page, or —
      if no browser is available — stated plainly and left to the human.

## Open questions

_None._ The human chose green for **Join**; **Open** keeps the old `btn-info`
teal. The dark shades are a visual choice, so the human is the authority for
them and tests that in the browser.
