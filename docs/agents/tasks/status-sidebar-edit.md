# Editable player status sidebar

- **Slug:** `status-sidebar-edit` · **Branch:** `feat/status-sidebar-edit` (stacked on `feat/display-settings`, PR #344, which is stacked on #343) · **Owner:** Claude (Sonnet 5.5) · **Status:** claimed

## Goal

The human's words: "kan vi legge inn støtte for å endre på de feltene man får
lov å endre på i status panelet? På sikt skal vi ikke trenge dette da vi skal
automatisere det. For panelet er deprecated. I tillegg må vi legge inn støtte
for å velge government, så kanskje hele den skal være den samme kombo boksen,
med ? i tillegg slik at man kan se governmentene og lese om de også." Must stay
mobile friendly.

## Scope

**In:** in the player status sidebar, make every field the old Player status
panel lets a player edit editable, and make Government a select with a `?`
button that opens the government card reference.

- Editable like in the old panel: Trade (capped by `tradeCeilingOf(civilization)`),
  Culture, Infantry, Artillery, Mounted, Stacking, Movement (`isMovementValue`),
  Combat hand size (`isCombatHandSizeValue`, length limit), EftA, Infra, MIC, PE,
  and the Aircraft yes/no.
- Read-only, as in the old panel: Coins total (sum of per-source counters), Culture
  hand size and Combat (both calculated by the engine).
- Government: a `<select>` over `GOVERNMENTS` saved with `api.setPlayerGovernment`,
  plus a `?` button (name "Show government card reference") that opens the same
  reference dialog the old panel uses. For a viewer who cannot edit (spectator,
  replay, locked game) the government is plain text but the `?` stays available.
- Same rules as the old panel: any member may edit any player (shared bookkeeping),
  fields are disabled while `busy` and when `readOnly`, saved through the `run`
  helper with `api.setPlayerStat` / `api.setPlayerGovernment`.

**Out:** the Coins per-source counters (the old panel's Coins tab); removing the old
panel; any server or engine change.

## Reference

`StatusPanel.tsx` (columns, `StatCell` validation and commit rules, the government
select, `ReferenceDialog` + `ReferenceCard` with `GOVERNMENT_CARDS`, how `busy`,
`readOnly` and `run` are passed from `GameView.tsx`), `PlayerStatusSidebar.tsx/.css/.test.tsx`,
`api.setPlayerStat` / `api.setPlayerGovernment` in `lib/api.ts`.

## Approach

- `PlayerStatusSidebar` gets `gameId`, `busy`, `readOnly`, `run` (the same props the
  old panel takes) and `GameView` passes them.
- Pull the input validation out of `StatCell` into one shared pure function (number
  with optional max, movement expression, free-text hand size) so the old cell and
  the new editor cannot drift; keep the old panel's behaviour and tests identical.
- Pull the government card reference dialog out of `StatusPanel` into a small shared
  component used by both, so there is one copy.
- Editing UI that works on a phone: the stat cell is the tap target (at least 44px)
  and opens a compact editor for that one field (a − / input / + stepper for numbers
  with Save on Enter or blur, a text input for Movement and Combat hand size, a
  switch for Aircraft); Escape cancels, an invalid entry reverts like the old cell;
  no horizontal overflow at 375px; keyboard and screen-reader usable with accessible
  names such as "Edit Alice Trade, currently 6". The 4-column grid must not break.

## Claimed paths

- `packages/web/src/views/PlayerStatusSidebar.tsx`, `.css`, `.test.tsx`
- `packages/web/src/views/StatusPanel.tsx`, `StatusPanel.test.tsx` (extraction only)
- new shared files for the validation and the government reference dialog
- `packages/web/src/views/GameView.tsx`, `packages/web/src/styles.css`

## Acceptance criteria

- [ ] Every editable field of the old panel can be edited in the sidebar, with the same validation
- [ ] Government select with `?` reference; `?` works for non-editors
- [ ] Read-only for spectators, replay and locked games; nothing is saved while busy
- [ ] Mobile friendly at 375px and desktop; keyboard and screen-reader usable
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: same data as the old panel; the existing leak test still holds
- [ ] Browser check: desktop and phone width

## Open questions

None blocking.
