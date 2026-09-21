# Gift a great person or the civ card

- **Slug:** `gift-greatperson-civ`
- **Branch:** `feat/gift-greatperson-civ`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

The "Give" control in the hand works for Great Person cards and for a player's
own civilization card, not only for Huts, Villages and Culture cards.

## Why

The human reported it directly:

> "Also, you cannot gift a greatperson or your civ starting tile. You can only
> gift hut, village and culture cards. Can you fix that too?"

In the rewrite the Give control is drawn on every card in the hand, but the
engine's `tradeToPlayer` filters the hand through `isTradable`, which is Culture
I/II/III, Hut and Village only — the old Java `Tradable` marker interface. Great
Person and Civ cards therefore reach the reducer and come back as
`ITEM_NOT_FOUND`. (In the old AngularJS client the "Send to Player" button was
drawn on the Tradable cards only; the show-everywhere behaviour is the
rewrite's.)

## Scope

**In:**

- Allow `tradeToPlayer` to move the two extra kinds the human named: Great
  Person and Civ.
- Keep `loot` restricted to the old `Tradable` set. Looting a Great Person or a
  Civ card was not asked for and would be a second, separate rule change.
- Giving the civ card moves **only the card**. The giver keeps their chosen
  civilization, government, starting tech, starting tile and leader marker; the
  receiver just holds the card. Recorded so the next reader knows it is
  deliberate, not an oversight.

**Out:**

- Units, Wonders, Tiles, City-states, Techs and Social Policies stay
  non-giftable. The human named Great Person and Civ only; widening further is a
  separate decision.
- Hiding the Give control on the cards that still cannot be given away. The
  control is drawn on every card today and that is unchanged; only the two named
  kinds start working.
- Any turn or timing rule. `tradeToPlayer` has none.

## Reference

`old-civ-rest/src/main/java/.../model/Tradable.java` is the old marker interface,
implemented by Culture I/II/III, Hut and Village; `PlayerAction.tradeToPlayer`
filters on it. The old client's Give control is built from the same set. This
change is therefore a **deliberate extension** past the old system, requested by
the human, and is recorded in `decisions.md` and `README.md`.

## Approach

- `packages/engine/src/item.ts`: add `isGiftable(item)`, true for the `Tradable`
  kinds plus `greatperson` and `civ`, with a comment saying it is a deliberate
  extension and that `isTradable` still governs looting.
- `packages/engine/src/actions/player.ts`: `tradeToPlayer` filters on
  `isGiftable` instead of `isTradable`; update its doc comment.
- No server or web change is needed: the route passes the sheet/item number/name
  through and the Give control already renders on every card.
- Tests: engine tests that a Great Person and a Civ card can be given, that
  giving the civ card leaves the chosen civilization in place, and that a Wonder
  still cannot be given; plus a loot regression pinning that a Great Person and
  a Civ card cannot be looted.
- `packages/engine/package.json`: declare `@types/node`, which its tests need for
  `node:fs`/`node:url`; without it `pnpm -r typecheck` fails on `main` after a
  lockfile refresh. `pnpm-lock.yaml` follows.
- Docs: `decisions.md`, `README.md` "Deliberate improvements", `state.md`.

## Claimed paths

- `docs/agents/tasks/gift-greatperson-civ.md`
- `docs/agents/task-board.md`
- `packages/engine/src/item.ts` (`isGiftable` only)
- `packages/engine/src/actions/player.ts` (`tradeToPlayer` filter and comment only)
- `packages/engine/package.json` (`@types/node` devDependency only)
- `pnpm-lock.yaml`
- `packages/engine/test/player-action.test.ts` (trade tests only)
- `packages/engine/test/draw-action.test.ts` (a loot regression test only)
- `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`

## Acceptance criteria

- [x] A Great Person can be given to another player: it leaves the giver's hand,
      joins the receiver's hand, and uses the existing trade log.
- [x] The Civ card can be given to another player the same way.
- [x] Giving the civ card leaves the giver's chosen civilization in place.
- [x] A Wonder (and the other kinds outside the set) still returns
      `ITEM_NOT_FOUND`.
- [x] Loot is unchanged: it still refuses a Great Person or a Civ card.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: trading only ever moves an item the giver already
      holds; no opponent hand is read or exposed.
- [x] Verified against a running server (no browser was connected): a Great
      Person given to the opponent left the giver's hand and joined theirs; the
      civ card did the same, and the giver's chosen civilization stayed set.
      Two public `TRADE_BETWEEN_PLAYERS` lines were written.

## Open questions

None that block. The human named the two kinds; every other item kind is
deliberately left alone. Giving the civ card moves only the card — the giver
keeps their civilization — which is the narrow reading of the request and is
recorded in `decisions.md`; if the whole civilization should transfer instead,
that is a larger, separate change.
