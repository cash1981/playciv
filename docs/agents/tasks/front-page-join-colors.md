# Colour the front page's Open and Join buttons

- **Slug:** `front-page-join-colors`
- **Branch:** `feat/front-page-join-colors`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

On the front page's **Active games** table, the two actions a signed-in player
can take on a row — **Open** a game they are already in, and **Join** a game
with a free seat — are both drawn as plain grey default buttons. They should be
coloured so they stand out from the table and from the disabled **Full**
button, matching the coloured Join button the old front page had.

## Why

The human asked directly, in Norwegian: *"Hvis du ser på old-civ-web så ser du
at forsiden hadde farger på join knappene. Det er vanskelig å 'Open' og 'join'
idag. Kan du gi samme farge som den forrige versjonen, og en farge i dark theme
som passer."*

`old-civ-web/app/views/list.html` rendered its Join action as
`<a class="btn btn-info">Join</a>`; Bootstrap 3's `.btn-info` is a teal
(`#5bc0de` background, `#46b8da` border, white text). The rewrite's list
(`GameList.tsx`) renders `Open` / `Join` as `className="small"`, i.e. the
unstyled grey default. This restores the old, recognisable teal in the light
theme and adds a dimmer teal for the dark theme, which is the client default.

## Scope

**In:**

- A new `info` button variant (after `primary` and `danger` in `styles.css`)
  with light-theme colours copied from Bootstrap's `.btn-info` and a separate,
  darker teal for the dark theme that fits the existing dark palette.
- The `Open` and `Join` action buttons in `GameList.tsx` get that variant
  (`className="small info"`).
- A `GameList.test.tsx` case that fails if either action loses the variant.

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
  2940–2954 — `.btn-info` and its `:hover`/`:focus` state.
- `packages/web/src/styles.css` — the `:root` / `:root[data-theme='light']`
  variable blocks and the `button`, `button.primary`, `button.danger`,
  `button.small` rules.
- `packages/web/src/views/GameList.tsx` — `actionCell`, which decides between
  Open, Join, Full and "Sign in to join".

## Approach

- `styles.css`: add five variables, `--info`, `--info-border`, `--info-text`,
  `--info-hover` and `--info-hover-border`, to the dark `:root` and to
  `:root[data-theme='light']`. Light uses Bootstrap's exact values
  (`#5bc0de` / `#46b8da` / `#fff`, hover `#31b0d5` / `#269abc`); dark uses a
  dimmer teal tuned to the dark panels. Add `button.info` and
  `button.info:hover:not(:disabled)` after the `danger` rule, before
  `button.small`, so it composes with `.small` and beats the generic
  `button:hover` accent border.
- `GameList.tsx`: the `Open` and `Join` buttons become `className="small info"`.
  `Full` and the `muted` "Sign in to join" text are unchanged.
- `GameList.test.tsx`: one new case asserting the `Open` and `Join` buttons
  carry the `info` class.

## Claimed paths

- `packages/web/src/styles.css`
- `packages/web/src/views/GameList.tsx`
- `packages/web/src/views/GameList.test.tsx`
- `docs/agents/tasks/front-page-join-colors.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] A signed-in player's `Open` and `Join` action buttons render with the
      `info` variant; `Full` stays the grey default.
- [ ] Light theme uses Bootstrap's `.btn-info` teal; dark theme uses a teal
      that reads against `--panel-2`.
- [ ] The `info` variant's hover state keeps its own background/border instead
      of the generic accent border.
- [ ] A test fails if `Open` or `Join` loses the variant.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: the buttons render only `game.id`, already public in
      the list, and read no hand or private state; no projection changes, so
      nothing can leak.
- [ ] Verified in the browser: both themes inspected on a live front page, or —
      if no browser is available — stated plainly and left to the human.

## Open questions

- **Both actions, one colour.** The old page had a single coloured Join and no
  Open action at all; the rewrite shows either Open or Join on a row, never
  both. Both therefore take the same `info` teal, which is the literal reading
  of "samme farge som den forrige versjonen" applied to both named buttons. If
  the human wants Open and Join told apart, Join keeps `info` and Open becomes
  `primary` — a one-line change.
