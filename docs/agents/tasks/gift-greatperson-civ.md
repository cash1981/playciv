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

The Give control is drawn on every card in the hand, but the engine's
`tradeToPlayer` filters the hand through `isTradable`, which is Culture I/II/III,
Hut and Village only — the old Java `Tradable` marker interface. Great Person
and Civ cards therefore reach the reducer and come back as `ITEM_NOT_FOUND`.

## Scope

**In:**

- Allow `tradeToPlayer` to move the two extra kinds the human named: Great
  Person and Civ.
- Keep `loot` restricted to the old `Tradable` set. Looting a Great Person or a
  Civ card was not asked for and would be a second, separate rule change.

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
- Tests: engine tests that a Great Person and a Civ card can be given, and that
  a Wonder still cannot.
- Docs: `decisions.md`, `README.md` "Known differences"/"Deliberate
  improvements", `state.md`.

## Claimed paths

- `docs/agents/tasks/gift-greatperson-civ.md`
- `docs/agents/task-board.md`
- `packages/engine/src/item.ts` (`isGiftable` only)
- `packages/engine/src/actions/player.ts` (`tradeToPlayer` filter and comment only)
- `packages/engine/test/player-action.test.ts` (trade tests only)
- `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`

## Acceptance criteria

- [ ] A Great Person can be given to another player: it leaves the giver's hand,
      joins the receiver's hand, and uses the existing trade log.
- [ ] The Civ card can be given to another player the same way.
- [ ] A Wonder (and the other kinds outside the set) still returns
      `ITEM_NOT_FOUND`.
- [ ] Loot is unchanged: it still refuses a Great Person or a Civ card.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: trading only ever moves an item the giver already
      holds; no opponent hand is read or exposed.
- [ ] Verified in the browser: a Give on a Great Person and on the Civ card
      succeeds. If no browser is available, verified against a running server
      and said so.

## Open questions

None that block. The human named the two kinds; every other item kind is
deliberately left alone, and the next step, if they want it, is to say so.
