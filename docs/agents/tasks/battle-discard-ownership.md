# Battle-related units are missing from, or unattributed in, the Revealed/Discarded panel

- **Slug:** `battle-discard-ownership`
- **Branch:** `fix/battle-discard-ownership`
- **Owner:** Claude (orchestrator)
- **Status:** draft

## Goal

Two related bugs in the "Revealed and Discarded Items" panel, both found from the
human's own game (`https://playciv.app/game/b87c44725c869148`):

1. **Missing entirely.** A player who reveals units "from their battlehand"
   (the pre-battle bluffing mechanic) sees the public log line
   ("cash reveals Mounted 1.3, Mounted 3.1, Infantry 2.2 from their
   battlehand"), but those units never appear in the panel at all.
2. **No owner shown.** A barbarian unit that gets discarded (after a battle
   against the barbarians ends) shows up in the panel, but with no "by X" tag,
   so it is indistinguishable from a blank/unknown entry.

Both should be fixed going forward, and — as much as can be done safely
without risking a hidden-information leak — for games that already have
affected data.

## Why

The human, in chat: "The discarded units from both me and the barbarians from
the battle doesnt show who owned the discarded units." then, after
confirmation and investigation, a second concrete repro: "cash reveals Mounted
1.3, Mounted 3.1, Infantry 2.2 from their battlehand, but I cannot see these in
revealed and discarded items."

Confirmed with the human:
- Bug 1 (battlehand): fix it (agreed it is a real bug, not an old-system
  quirk to preserve).
- Bug 1, existing games: attempt a migration, accepting the small
  documented risk below (a specific, low-probability false-positive reveal
  scenario) rather than leaving old data unfixed.
- Bug 2 (barbarian ownership): show a generic "Barbarians" label rather than
  the player who happened to be controlling them, since barbarians are not
  actually owned by any player.

## Scope

**In:**

- `packages/engine/src/actions/draw.ts`: `revealAndDiscardBattlehand` must
  flip `hidden: false` on the specific unit instances (matched by `item.id`,
  not name) it moves out of the battlehand, so `revealedFeed`'s existing
  "non-hidden hand item" rule picks them up. No change to the log message
  text (already faithful to Java's wording).
- `packages/engine/src/actions/game.ts`: `revealedFeed` must label a
  discarded unit whose `ownerId` is `null` (today this is only possible via
  `discardBarbarians`, which explicitly nulls it — see Reference) as
  `username: 'Barbarians'`, instead of leaving `username: null`. `playerId`
  stays `null` — no synthetic player identity is invented, only a display
  label.
- `packages/engine/src/migrate.ts`: a new step in `migrateGameState` that
  retroactively reveals (`hidden: false`) units named in an existing
  `"<username> reveals <names> from their battlehand"` public log line, for
  hidden unit items still identifiable in that player's hand — see Approach
  for the exact-count-match safety rule. Runs on every read, like every other
  migration in this file; no separate script.
- Tests for all three (see Acceptance criteria).

**Out:**

- The barbarian-ownership fix does not change `Item.ownerId` itself (stays
  `null`, matching Java) and does not touch `discardBarbarians`'s public log
  message.
- No fix for a player's own battle-killed unit discard — confirmed via a live
  browser check on the human's own game that this path already works
  correctly (shows "by <username>") once manually discarded via the normal
  hand-discard action; not a bug.
- No UI/`RevealedPanel.tsx` change — `RevealedRow` already renders
  `by {username}` whenever `username !== null`, so both fixes are entirely
  visible through the existing rendering.

## Reference

No old-system rule is being changed. Investigated both old repos:

- `old-civ-rest`'s `DrawAction.discardBarbarians` also nulls the unit's owner
  before adding to `discardedItems` (`unit.setOwnerId(null)`), and its
  `revealAndDiscardUnits` (called by `revealAndDiscardBattlehand`) only
  appends to a log-message `StringBuilder` — it never flips `Unit.hidden`
  either. Both TS behaviours are faithful ports.
- `old-civ-web`'s `revealed.html` shows no owner/username for anything, in
  any category — there was no old "Barbarians" pseudo-owner label to port,
  and no structured "is this publicly known" view at all comparable to the
  new `revealedFeed`/`RevealedPanel` (issue #51, confirmed already with no
  precedent when issue #166 was investigated).

Both bugs exist only because `revealedFeed` (new, issue #51) invented a
structured invariant — "shows exactly what is publicly known" via
`item.hidden` and `item.ownerId` — that the two Java actions above were never
written to keep consistent, because Java had no equivalent read model
depending on those fields for this purpose. Fixing them makes the new panel
correctly implement its own already-stated promise; it does not restore or
contradict an old rule.

## Approach

### Bug 1 — reveal on battlehand-reveal (forward fix)

In `revealAndDiscardBattlehand`, capture `player.battlehand`'s item ids before
clearing it, and map `player.items` to flip `hidden: false` on any item whose
`id` is in that set, alongside the existing `battlehand: []`. Matching by
`id` (unique) rather than by display name avoids any ambiguity for the
forward-fix path.

### Bug 1 — migration for existing games

`migrateGameState` runs on every read (per its own doc comment), so this is a
read-time fix with no separate script, consistent with every other migration
in that file.

For each `state.log` entry whose `publicLog` matches exactly
`` `${entry.username} reveals ${namesPart} from their battlehand` `` (the
literal template `revealAndDiscardBattlehand` writes), split `namesPart` on
`', '` to get the list of `revealAll()` display names it named, and look up
the acting player via `entry.playerId`.

**Safety rule (the small, documented risk the human accepted):** display
names are not unique identifiers — two hidden units of the same type/level
can coexist in one hand. So for each distinct name in that log entry's list,
compare two counts: how many times the name appears in *this event's* list,
versus how many still-hidden unit items with that exact `revealAll()` name
exist in the player's current hand. Only reveal (all of) them when the two
counts match exactly; otherwise leave every item with that name untouched for
that entry. This never reveals a card that cannot be positively identified,
at the cost of leaving a genuinely-ambiguous historical case still hidden
(logged as a residual limitation in `decisions.md`, not solved here).

Iterate `state.log` in its existing (chronological) order so an earlner event
cannot double-claim a unit a later event also names.

### Bug 2 — "Barbarians" label

In `revealedFeed`'s final mapping, when a row's `playerId` is `null` and its
item `isUnit`, set `username: 'Barbarians'` instead of `nameOf(null)` (which
is always `null`). `playerId` itself is left `null` — no lookup, no
synthetic player object. Every other `playerId === null` case (a non-unit,
which today cannot happen per the Reference section, but kept as a guard)
keeps `username: null` exactly as before.

## Claimed paths

- `packages/engine/src/actions/draw.ts`
- `packages/engine/src/actions/game.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/test/revealed-feed.test.ts`
- `packages/engine/test/migrate.test.ts` (or wherever existing migration
  tests live — confirm exact file before editing)
- `packages/engine/test/draw.test.ts` (or wherever `revealAndDiscardBattlehand`
  is already tested — confirm before editing)

## Acceptance criteria

- [ ] A unit revealed via `revealAndDiscardBattlehand` is `hidden: false`
      afterward and appears in `revealedFeed` with `revealed: true`.
- [ ] A discarded barbarian unit's `revealedFeed` entry has `username:
      'Barbarians'` and `playerId: null`.
- [ ] The existing test documenting "none of the discarded barbarians get
      enriched" (ordering test, `revealed-feed.test.ts`) still passes
      unchanged — this fix only changes the derived `username`, not
      `playerId`/`createdAt`/`logOrder`.
- [ ] Migration test: a hand-built old-shaped `GameState` with a
      battlehand-reveal log line and a matching still-hidden unit gets it
      revealed by `migrateGameState`.
- [ ] Migration test: the same, but with two hidden units sharing the exact
      display name where the log only named one — `migrateGameState` leaves
      both hidden (the safety rule proven, not just asserted in a comment).
- [ ] No hidden-information regression elsewhere: a hidden item never named
      in any battlehand-reveal log line stays hidden after migration.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Read-only `reviewer` pass, run to zero findings.
- [ ] Read-only `rules-checker` pass (this touches a projection and a
      migration), run to zero findings.
- [ ] Verified in the browser against the human's real game
      (`https://playciv.app/game/b87c44725c869148`) once deployed: the
      barbarian-discarded units show "by Barbarians", and (if that game has
      no further battlehand-reveal event to check live) at least the
      migration test stands in for the "existing games" criterion.

## Open questions

None outstanding — both the battlehand fix-forward decision and the
migration-vs-not decision (with its residual risk) were confirmed with the
human before starting.
