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

Both are fixed going forward. A migration to backfill already-affected games
for bug 1 was attempted, found genuinely unsafe on review (not just for old
saves — it could misfire on an ordinary new game too), and dropped at the
human's choice; see Approach and `decisions.md`.

## Why

The human, in chat: "The discarded units from both me and the barbarians from
the battle doesnt show who owned the discarded units." then, after
confirmation and investigation, a second concrete repro: "cash reveals Mounted
1.3, Mounted 3.1, Infantry 2.2 from their battlehand, but I cannot see these in
revealed and discarded items."

Confirmed with the human:
- Bug 1 (battlehand): fix it (agreed it is a real bug, not an old-system
  quirk to preserve).
- Bug 1, existing games: first agreed to attempt a migration, accepting a
  documented risk. Read-only review found the actual risk broader than
  described — not just two duplicate-named hidden units coexisting, but the
  ordinary case of a named unit later being discarded and a fresh duplicate
  drawn afterward, which the migration could not tell apart from the
  original and would misidentify even in new, post-fix games. Presented with
  the corrected risk, the human chose to drop the migration entirely rather
  than tighten it further or ship it as-is.
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
- Tests for both (see Acceptance criteria).

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
- No migration. `packages/engine/src/migrate.ts` is untouched: a game already
  holding a unit stuck hidden from before this fix stays that way. See
  Approach and `decisions.md`, 2026-09-25, for why a name-matching migration
  was attempted and abandoned.

## Reference

**Correction from round-1 review:** an earlier draft of this brief claimed
`revealedFeed` had no old-system counterpart at all. That is wrong.
`allRevealedItems` (`packages/engine/src/actions/game.ts`) already ports
`GameAction.getAllRevealedItems` (`GameAction.java:852-864`) verbatim —
discarded items plus every player's non-hidden hand items — and
`revealedFeed` is seeded from exactly that set. So bug 1 is not a gap in
something new; it is **an old-system bug being corrected**:

- `old-civ-rest`'s `DrawAction.revealAndDiscardBattlehand`
  (`DrawAction.java:308-331`) calls `revealAndDiscardUnits`, whose
  `revealUnitConsumer` (line 58) only appends to a log-message
  `StringBuilder` — it never calls `setHidden(false)` on the actual units.
  `DrawActionTest.java:352-375` only asserts the battlehand list itself
  empties; it never checks `hidden`. Since `getAllRevealedItems` also filters
  on `!isHidden()`, these units were invisible to Java's own public-items
  view too, despite the log line right next to it declaring them public.
  Corrected here; not backported to old data (see Scope/Approach — the
  migration that would have done this was abandoned).
- `old-civ-rest`'s `DrawAction.discardBarbarians` (`DrawAction.java:296-306`)
  nulls the unit's owner before adding it to `discardedItems`
  (`unit.setOwnerId(null)`) — correct, faithfully ported, and *not* changed
  by this fix. `old-civ-web`'s `revealed.html`/`ReavledController.js` show no
  owner/username for anything, in any category, so there is no old
  "Barbarians" pseudo-owner label to port from — that part of bug 2 is a new
  display choice, not a correction of an old rule. It is recorded as a
  "Deliberate improvement" in README, not a "Known difference".

## Approach

### Bug 1 — reveal on battlehand-reveal (forward fix)

In `revealAndDiscardBattlehand`, capture `player.battlehand`'s item ids before
clearing it, and map `player.items` to flip `hidden: false` on any item whose
`id` is in that set, alongside the existing `battlehand: []`. Matching by
`id` (unique) rather than by display name avoids any ambiguity for the
forward-fix path.

### Bug 1 — migration for existing games: attempted, abandoned

A first version matched a `state.log` entry's `publicLog` text (the literal
`` `${username} reveals ${names} from their battlehand` `` template) to get
the `revealAll()` display names it named, then resolved a name to a hidden
unit item in the acting player's current hand only when the count of times
that name appeared in the log entry exactly matched the count of still-hidden
candidates with that name in the hand — otherwise leaving every item with
that name untouched.

Round-1 review found this unsafe beyond what was scoped: the count rule
compares against the *current* hand, which cannot distinguish "the other
same-named unit is still there, unrevealed" from "the named unit left the
hand since (discarded, looted, reshuffled) and a different, never-named unit
with the same display name was drawn afterward" — an ordinary sequence of
play, not a rare coincidence, and not limited to old saves: it could
misidentify a unit in a brand-new, post-fix game the moment two same-labelled
units exist and only one has actually been revealed. That is a genuine
hidden-information leak (AGENTS.md rule 4), not the narrower "leaves an
ambiguous case unfixed" trade-off originally described to the human. Given
the corrected picture, the human chose to drop the migration rather than
tighten it (e.g. cross-checking the log for a later re-draw of the same
sheet) or ship it as-is — see `decisions.md`. `packages/engine/src/migrate.ts`
is untouched by the final diff.

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
- `packages/engine/test/revealed-feed.test.ts`
- `packages/engine/test/draw-action.test.ts`
- `README.md`
- `docs/agents/decisions.md`

## Acceptance criteria

- [x] A unit revealed via `revealAndDiscardBattlehand` is `hidden: false`
      afterward and appears in `revealedFeed` with `revealed: true`.
- [x] A discarded barbarian unit's `revealedFeed` entry has `username:
      'Barbarians'` and `playerId: null`.
- [x] The existing test documenting "none of the discarded barbarians get
      enriched" (ordering test, `revealed-feed.test.ts`) still passes
      unchanged — this fix only changes the derived `username`, not
      `playerId`/`createdAt`/`logOrder`.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass (559
      engine, 208 server, 245 web tests).
- [ ] Read-only `reviewer` pass, run to zero findings. Round 1 found the
      migration unsafe (dropped, see above) plus a missing `decisions.md`/
      README write-up (added); round 2 pending on the updated diff.
- [x] Read-only `rules-checker` pass — round 1 confirmed both fixes correct
      an old-system bug / add a new display choice rather than contradicting
      a real old rule, and flagged the missing write-up (now added) and the
      brief's own wrong "no old precedent" claim (now corrected above).
- [ ] Verified in the browser against the human's real game
      (`https://playciv.app/game/b87c44725c869148`) once deployed: the
      barbarian-discarded units show "by Barbarians". The battlehand fix
      itself cannot be re-verified live on that specific game without a new
      battlehand-reveal event, since no migration restores the one already
      in its history; covered instead by the engine tests.

## Open questions

None outstanding. The migration-vs-not decision was revisited once, with
corrected information from round-1 review, and resolved: no migration.
