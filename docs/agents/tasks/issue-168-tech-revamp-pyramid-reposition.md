# Tech revamp follow-up: freeform pyramid repositioning (Tesla / Newton)

- **Slug:** `issue-168-tech-revamp-pyramid-reposition`
- **Branch:** `feat/issue-168-tech-revamp` (same branch as issue #168's already-merged-ready PR #170 — the human asked for this to land in the same PR before merge, not a follow-up)
- **Owner:** orchestrator (Claude, Opus 5.5)
- **Status:** ready for the coder

## Goal

A player can freely move one of their own researched tech cards to a different
row of their own tech pyramid than the tech's real level, and can place the
Great Person "Sir Isaac Newton" face-down into a pyramid row as a blank
occupant. Both are permanent, visible parts of that player's public pyramid
once revealed/placed — everyone sees the same layout, same as any other board
fixture.

## Why

Two Great Person cards need this to make sense on the board:

- **Nikola Tesla** (`Great Person` sheet): *"Research: You may discard this
  card when adding a tech of level II, III, or IV to your tech pyramid to
  place it one level lower in the pyramid than normal."*
- **Sir Isaac Newton** (`Great Person` sheet): *"Research: Before researching,
  you may place this card facedown in your tech pyramid as a blank tech card
  of level IV or less. It remains in your tech pyramid for the rest of the
  game, even if Newton dies."*

The human confirmed, after checking the actual card text (an earlier draft of
this brief wrongly named this "Thomas Edison" with a different effect — that
was a misremembering, corrected in conversation): implement **only the
repositioning capability itself**, generically, with **no rule
enforcement** — no check that a card was actually discarded, no check on
which tech triggered it, no level-difference validation, no phase/turn
gating. The player moves cards themselves; the system's only job is to
remember where they put them so the layout is correct on the next page load.
Quoting the human directly: *"Poenget er det samme. Vi trenger
funksjonaliteten... la spillerne selv få lov til å flytte rundt på
plasseringene av techene sine. For nå tenker jeg det ikke er nødvendig å
logge selve flyttingene."* (The point is the same — we need the
functionality... let the players themselves move their techs' placements
around. For now I don't think the moves themselves need to be logged.)

Do **not** implement Edison at all — the human confirmed choosing a tech works
exactly as it does today for that case, nothing to add.

## Scope

**In:**

- A tech a player has chosen can be displayed in a pyramid row other than its
  real level, changeable by the player at any time, persisted so it survives
  a reload.
- Sir Isaac Newton specifically (by exact name match) gets a "Place in tech
  pyramid" action from the hand, after which he leaves the normal hand/item
  list and becomes a permanent blank occupant of a pyramid row the player
  picks (and can still move afterward, same as a repositioned tech).
- The repositioned/placed state is part of the same public projection that
  already exposes revealed techs (`revealedTechs`) — no separate reveal step.
  This is the orchestrator's own call, stated in conversation and not
  contradicted: a moved or placed card is exactly as visible as any other
  already-public pyramid content, consistent with how Wonders are immediately
  public once placed on the board. If this turns out to be wrong, it is a
  small, reversible follow-up (stop exposing the field), not a redesign.
- No validation of game-rule legality anywhere (not which techs are eligible,
  not whether Tesla/Newton was actually discarded/available, not a level
  bound tied to the printed "level IV or less" on Newton — the slot input is
  just 1-5 for both, kept simple rather than card-specific). Only ordinary
  access control (a player can only move their own cards) and basic input
  shape (`slot` is an integer 1-5) are checked.
- No public log entry for a reposition or a placement — explicitly asked not
  to.
- A cropped, background-free generic card-back image for a placed Great
  Person's blank pyramid slot, already prepared by the orchestrator (see
  Assets below) — do not re-crop it.

**Out:**

- Thomas Edison, or any other Great Person's printed effect — not part of
  this brief.
- Any legality/eligibility checking of Tesla's or Newton's printed
  conditions.
- Drag-and-drop. The interaction is a simple stepper (buttons or a `<select>`)
  on each pyramid slot, per the orchestrator's design call below — faster to
  build, and accessible by construction. If the human wants real drag-and-drop
  later, that is a separate follow-up.
- Removing/undoing a Newton placement once made (matches the printed card:
  "remains in your tech pyramid for the rest of the game, even if Newton
  dies"). Repositioning a placed Newton to a different row is still allowed
  (that's the whole feature); taking him back out of the pyramid entirely is
  not.

## Reference

New mechanic, no old-system equivalent (`old-civ-rest`/`old-civ-web` have no
Tesla or Newton logic at all — confirmed by grep, zero matches). The printed
card text above, from `packages/engine/data/gamedata-faf-waw.json`'s
`Great Person` sheet, is the only source of truth for *why* this exists; the
implementation itself is deliberately unenforced, per the human's explicit
instruction, so there is nothing further to port.

## Approach

### 1. Engine: `packages/engine/src/item.ts`

Add an optional display-slot override to `TechItem`:

```ts
export interface TechItem extends ItemBase {
  readonly kind: 'tech'
  readonly sheetName: 'LEVEL_1_TECH' | 'LEVEL_2_TECH' | 'LEVEL_3_TECH' | 'LEVEL_4_TECH' | 'LEVEL_5_TECH'
  readonly name: string
  readonly type: string | null
  readonly level: 1 | 2 | 3 | 4 | 5
  /** Where a Great Person (Nikola Tesla) has moved this tech's pyramid row.
   *  Unenforced display override; `level` itself never changes. Defaults to
   *  `level` when absent. */
  readonly slot?: 1 | 2 | 3 | 4 | 5
}
```

Add a new exported type for a placed blank occupant (used by `Playerhand`
below — put it in `item.ts` next to `TechItem` since it's conceptually a
pyramid-slot occupant, not full item state):

```ts
export interface PyramidPlacement {
  readonly name: string
  readonly slot: 1 | 2 | 3 | 4 | 5
}
```

### 2. Engine: `packages/engine/src/state.ts`

Add to `Playerhand` (near `techsChosen`, `packages/engine/src/state.ts:108`):

```ts
/** Great Persons placed face-down as a blank pyramid occupant (Sir Isaac
 *  Newton). Always public once placed — see the task brief. */
readonly pyramidPlacements: readonly PyramidPlacement[]
```

Import `PyramidPlacement` from `./item.js`.

In `opaque()` (`state.ts:400-430`), add `pyramidPlacements: player.pyramidPlacements,` to the
returned `OpaquePlayerhand` — it's public, unlike `techsChosen` (no filtering
needed, unlike `revealedTechs`). Add the same field to the `OpaquePlayerhand`
interface. `you` (`toPlayerView`, `state.ts:527+`) already spreads the whole
`Playerhand`, so the own view gets it for free once the field exists.

### 3. Engine: `packages/engine/src/migrate.ts`

`withPlayerDefaults` (`migrate.ts:66-71`) fills in fields that didn't exist in
older saves. Add `pyramidPlacements: player.pyramidPlacements ?? [],` there,
and update `MaybeOlderPlayerhand` (`migrate.ts:30-31`) to include
`'pyramidPlacements'` in the `Omit`/`Partial` pair, same pattern as `stats`/
`government`.

### 4. Engine: `packages/engine/src/actions/player.ts`

Three new actions, right after `revealTech` (around line 140). Follow
`revealTech`'s/`removeTech`'s exact shape: `requireAccess(state, input.playerId)`
for self-only access (no separate editor/target — a player only ever moves
their own cards), find-or-404 via `ITEM_NOT_FOUND`, `withPlayer(...)`, and
**no `appendLog`/`appendItemLog` call** — the human explicitly does not want
these logged.

```ts
export interface SetTechSlotInput {
  readonly playerId: string
  readonly techName: string
  readonly slot: 1 | 2 | 3 | 4 | 5
}

/**
 * New in this port, no old-system equivalent — see decisions.md. Lets a
 * player change which pyramid row one of their own chosen techs displays in.
 * Deliberately unvalidated against any card's printed rule text (Nikola
 * Tesla's effect, or anything else): the player manages this themselves.
 */
export function setTechSlot(state: GameState, input: SetTechSlotInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const tech = player.techsChosen.find((candidate) => candidate.name === input.techName)
  if (tech === undefined) return err({ kind: 'ITEM_NOT_FOUND' })

  const moved: TechItem = { ...tech, slot: input.slot }
  return ok(
    withPlayer(state, {
      ...player,
      techsChosen: player.techsChosen.map((candidate) =>
        candidate.name === tech.name ? moved : candidate,
      ),
    }),
  )
}

export interface PlaceGreatPersonInput {
  readonly playerId: string
  readonly itemId: string
  readonly slot: 1 | 2 | 3 | 4 | 5
}

/**
 * New in this port, no old-system equivalent — see decisions.md. Takes a
 * Great Person out of the normal hand and records it as a blank pyramid
 * occupant at the given row (Sir Isaac Newton's printed effect). Anyone's
 * Great Person can be placed at the engine level — the web client is what
 * restricts the button to Newton by name; see the client section below.
 */
export function placeGreatPersonInPyramid(state: GameState, input: PlaceGreatPersonInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const item = player.items.find((candidate) => candidate.id === input.itemId)
  if (item === undefined || item.kind !== 'greatperson') return err({ kind: 'ITEM_NOT_FOUND' })

  return ok(
    withPlayer(state, {
      ...player,
      items: player.items.filter((candidate) => candidate.id !== item.id),
      pyramidPlacements: [...player.pyramidPlacements, { name: item.name, slot: input.slot }],
    }),
  )
}

export interface SetPyramidPlacementSlotInput {
  readonly playerId: string
  readonly name: string
  readonly slot: 1 | 2 | 3 | 4 | 5
}

/** Moves an already-placed Great Person (see `placeGreatPersonInPyramid`) to
 *  a different pyramid row. Same unenforced/unlogged shape as `setTechSlot`. */
export function setPyramidPlacementSlot(state: GameState, input: SetPyramidPlacementSlotInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const placement = player.pyramidPlacements.find((candidate) => candidate.name === input.name)
  if (placement === undefined) return err({ kind: 'ITEM_NOT_FOUND' })

  return ok(
    withPlayer(state, {
      ...player,
      pyramidPlacements: player.pyramidPlacements.map((candidate) =>
        candidate.name === input.name ? { ...candidate, slot: input.slot } : candidate,
      ),
    }),
  )
}
```

Check `ActionResult`'s `err({ kind: 'ITEM_NOT_FOUND' })` shape matches what
`errors.ts` actually declares (it's used the same way by `chooseTech` a few
lines above, so it should just work — flag it if not).

### 5. Server: `packages/server/src/routes/play.ts`

Three new routes, next to the existing `techs/choose`/`remove`/`reveal`
(`play.ts:206-236`). Same shape: `auth` middleware, parse the body with
`requireString`/`asRecord`, 400 on a missing/wrong-shaped field,
`applyToGame(...)`. For `slot`, validate it is an integer 1-5 and 400
otherwise — there's no existing `requireNumber` helper (only
`optionalNumber`, `context.ts:345`), so either add one or inline the check;
match whichever is less code.

```ts
app.post('/api/games/:gameId/techs/slot', auth, async (c) => {
  const gameId = c.req.param('gameId')
  const body = asRecord(await c.req.json().catch(() => ({})))
  const techName = requireString(body, 'name')
  const slot = body.slot
  if (techName === undefined || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 5) {
    return sendError(c, 400, 'BAD_REQUEST', 'name and an integer slot 1-5 are required')
  }
  return applyToGame(context, c, gameId, (state) =>
    setTechSlot(state, { playerId: currentPlayer(c).id, techName, slot: slot as 1 | 2 | 3 | 4 | 5 }),
  )
})

app.post('/api/games/:gameId/greatperson/place', auth, async (c) => {
  const gameId = c.req.param('gameId')
  const body = asRecord(await c.req.json().catch(() => ({})))
  const itemId = requireString(body, 'itemId')
  const slot = body.slot
  if (itemId === undefined || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 5) {
    return sendError(c, 400, 'BAD_REQUEST', 'itemId and an integer slot 1-5 are required')
  }
  return applyToGame(context, c, gameId, (state) =>
    placeGreatPersonInPyramid(state, { playerId: currentPlayer(c).id, itemId, slot: slot as 1 | 2 | 3 | 4 | 5 }),
  )
})

app.post('/api/games/:gameId/greatperson/slot', auth, async (c) => {
  const gameId = c.req.param('gameId')
  const body = asRecord(await c.req.json().catch(() => ({})))
  const name = requireString(body, 'name')
  const slot = body.slot
  if (name === undefined || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 5) {
    return sendError(c, 400, 'BAD_REQUEST', 'name and an integer slot 1-5 are required')
  }
  return applyToGame(context, c, gameId, (state) =>
    setPyramidPlacementSlot(state, { playerId: currentPlayer(c).id, name, slot: slot as 1 | 2 | 3 | 4 | 5 }),
  )
})
```

Add the three new engine functions to this file's import list.

### 6. Client: `packages/web/src/lib/api.ts`

Next to `chooseTech`/`removeTech`/`revealTech` (`api.ts:415-420`):

```ts
setTechSlot: (gameId: string, name: string, slot: 1 | 2 | 3 | 4 | 5) =>
  post<PlayerView>(`/api/games/${gameId}/techs/slot`, { name, slot }),
placeGreatPersonInPyramid: (gameId: string, itemId: string, slot: 1 | 2 | 3 | 4 | 5) =>
  post<PlayerView>(`/api/games/${gameId}/greatperson/place`, { itemId, slot }),
setPyramidPlacementSlot: (gameId: string, name: string, slot: 1 | 2 | 3 | 4 | 5) =>
  post<PlayerView>(`/api/games/${gameId}/greatperson/slot`, { name, slot }),
```

### 7. Client: `packages/web/src/views/TechTree.tsx`

Extend `TechTreeTech` with `readonly slot?: Level`, and add a new exported
type:

```ts
export interface TechTreePlacement {
  readonly name: string
  readonly slot: Level
}
```

Group by `tech.slot ?? tech.level` instead of `tech.level` (the one line at
`TechTree.tsx:51`, `researched = techs.filter(...)`). Render placements as
their own slot type in the matching row, using a new fixed asset path (not
`techCardImageUrl`, since it's not name-derived): `/items/greatperson_back.jpg`.

Add props (all optional, so the opponent-tab render call below can omit them
and get a read-only pyramid exactly like today):

```ts
interface Props {
  readonly techs: readonly TechTreeTech[]
  readonly placements?: readonly TechTreePlacement[]
  readonly disabled?: boolean
  /** Present only on the viewer's own pyramid. */
  readonly onTechSlotChange?: (techName: string, slot: Level) => void
  readonly onPlacementSlotChange?: (name: string, slot: Level) => void
}
```

For each researched-tech slot and each placement slot, when the matching
`onXSlotChange` prop is provided, render a small up/down control, e.g.:

```tsx
{onTechSlotChange !== undefined && (
  <span className="tech-slot-move">
    <button
      type="button"
      className="small"
      disabled={disabled === true || (tech.slot ?? tech.level) <= 1}
      aria-label={`Move ${tech.name} to a lower pyramid level`}
      onClick={() => onTechSlotChange(tech.name, ((tech.slot ?? tech.level) - 1) as Level)}
    >
      ▼
    </button>
    <button
      type="button"
      className="small"
      disabled={disabled === true || (tech.slot ?? tech.level) >= 5}
      aria-label={`Move ${tech.name} to a higher pyramid level`}
      onClick={() => onTechSlotChange(tech.name, ((tech.slot ?? tech.level) + 1) as Level)}
    >
      ▲
    </button>
  </span>
)}
```

("Lower"/"higher" here mean the row number, 1 to 5 — level 1 is the base of
the pyramid, level 5 the apex, per `LEVELS_APEX_FIRST`; word it however reads
correctly given that layout, check against the rendered rows rather than
trusting this snippet's wording blindly.) Same shape for a placement's
`onPlacementSlotChange`. Keep the existing `hidden`-badge and empty-slot
rendering exactly as is.

### 8. Client: `packages/web/src/views/TechPanel.tsx`

- `TechTab` (`TechPanel.tsx:52-64`) gains `placements: readonly TechTreePlacement[]`.
- Own tab's `techs` mapping (`TechPanel.tsx:111-115`) gains `slot: tech.slot`;
  own tab gains `placements: view.you.pyramidPlacements`.
- Opponent tab's `techs` mapping (`TechPanel.tsx:124`) gains `slot: tech.slot`
  (flows through automatically once `revealedTechs` items carry `.slot` —
  check `PlayerView`'s opponent type actually has `pyramidPlacements` after
  the state.ts change); opponent tab gains
  `placements: opponent.pyramidPlacements`.
- Where `<TechTree techs={active.techs} />` is rendered (`TechPanel.tsx`
  inside the `active !== undefined` block), pass:

```tsx
<TechTree
  techs={active.techs}
  placements={active.placements}
  disabled={busy}
  onTechSlotChange={
    active.own
      ? (techName, slot) => void run(() => api.setTechSlot(gameId, techName, slot))
      : undefined
  }
  onPlacementSlotChange={
    active.own
      ? (name, slot) => void run(() => api.setPyramidPlacementSlot(gameId, name, slot))
      : undefined
  }
/>
```

### 9. Client: `packages/web/src/views/GameView.tsx`

In `HandItem` (`GameView.tsx:718-767`), add a control visible only when
`item.kind === 'greatperson' && item.name === 'Sir Isaac Newton'`, next to the
existing Discard/Give buttons: a level `<select>` (1-5) plus a "Place in tech
pyramid" button that calls
`api.placeGreatPersonInPyramid(gameId, item.id, chosenSlot)` through `run(...)`.
Keep it simple — local `useState` for the chosen level, defaulting to `1`,
scoped to this one component instance.

## Assets

`packages/web/public/items/greatperson_back.jpg` already exists (added by the
orchestrator, cropped from a screenshot the human supplied, background
removed the same way the tech cards were). Do not re-crop or replace it —
just reference it from `TechTree.tsx` as described above. It is a generic
card back (a compass-rose design), not specific to Newton, used for any
placed Great Person.

## Claimed paths

- `packages/engine/src/item.ts`
- `packages/engine/src/state.ts`
- `packages/engine/src/state.test.ts` (or wherever `opaque()`/projection tests live — find it)
- `packages/engine/src/migrate.ts`
- `packages/engine/src/actions/player.ts`
- `packages/engine/test/` — new tests for the three actions and the migration default
- `packages/server/src/routes/play.ts`
- `packages/server/test/` — new route tests
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/TechTree.tsx`
- `packages/web/src/views/TechTree.test.tsx`
- `packages/web/src/views/TechPanel.tsx`
- `packages/web/src/views/TechPanel.test.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/GameView.test.tsx` (or wherever `HandItem`/hand tests live)
- `packages/web/src/styles.css`
- `packages/web/public/items/greatperson_back.jpg` (already added, read-only for the coder)

## Acceptance criteria

- [ ] A player can move any of their own chosen techs to a different pyramid
      row via the new stepper control, on their own tab only — the control
      does not appear on an opponent's tab.
- [ ] The moved position persists: reloading the page (or re-fetching
      `PlayerView`) shows the tech in the row it was moved to, not its real
      level.
- [ ] The moved position is visible to an opponent viewing that player's
      revealed pyramid (assuming the tech itself is revealed) — confirm this
      matches the orchestrator's stated assumption in this brief; if the
      human says otherwise when this is shown to them, that's a follow-up,
      not a blocker for this round.
- [ ] Sir Isaac Newton, and only Sir Isaac Newton, gets a "Place in tech
      pyramid" control in the hand view. Placing him removes him from the
      normal hand/item list and adds a blank occupant (the generic card-back
      image) to the chosen pyramid row, on both the owner's and an opponent's
      view of that pyramid.
- [ ] A placed Newton can still be moved afterward via the same stepper
      control placements get.
- [ ] No public log entry is created by a tech-slot move, a Newton placement,
      or a placement-slot move.
- [ ] A game saved before this feature existed loads correctly (migration
      test): `pyramidPlacements` defaults to `[]`, `TechItem.slot` being
      absent is handled as "use `level`" everywhere it's read.
- [ ] Hidden information: a player can only move their own cards
      (`requireAccess`/`playerId` ownership, same as `chooseTech`) — a test
      proves another player's `setTechSlot`/`placeGreatPersonInPyramid`/
      `setPyramidPlacementSlot` call is rejected. `pyramidPlacements` itself
      carries no hidden data (it's public by design), so there is nothing to
      leak-test there the way `revealedTechs` needs one — say explicitly in
      the report that this was considered, not skipped by omission.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser: move a researched tech up/down the pyramid and
      see it land in the new row after a reload; place Newton and see the
      blank card appear; confirm the controls are absent on an opponent's
      tab.

## Open questions

Two design calls were made by the orchestrator without a full round-trip
confirmation from the human (the human dismissed a follow-up question batch
about UI style, visibility timing and edit rights, saying only that
persistence is required, moves don't need logging, and players manage their
own cards). State these plainly when reporting the finished work, so the
human can correct either cheaply:

1. **Immediate public visibility** — a moved/placed slot is exposed the same
   way `revealedTechs` already is, no separate reveal step. Reasoned from
   "PBF game, opponents should see the same board", not an explicit
   instruction.
2. **Stepper control, not drag-and-drop** — chosen for build/test cost and
   accessibility, not requested outright either way.

If either is wrong, both are small, isolated changes (a projection field, or
a control's markup) rather than a redesign of the action/state model above.
