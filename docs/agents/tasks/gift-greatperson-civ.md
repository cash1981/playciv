# Only Tradable cards can be given away

- **Slug:** `gift-greatperson-civ`
- **Branch:** `feat/gift-greatperson-civ`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

The hand's "Give" control is offered only for the cards the game actually
allows to be given away — Culture I/II/III, Hut and Village. Great Person, Civ,
City-state, units, wonders, tiles, techs and social policies no longer show a
Give control that would fail.

## Why

The human reported it directly:

> "Look at game ... I build branch feature/gift-greatperson-civ and it is not
> working. You can still give away greatperson, citystate and your civ. None of
> which should be possible."

The engine's `tradeToPlayer` has always filtered on Java's `Tradable` marker
(Culture I/II/III, Hut, Village), so the other kinds come back `ITEM_NOT_FOUND`.
The rewrite, however, drew the Give select and button on **every** hand card, so
those cards offered a click that could never succeed. The old AngularJS client
drew its "Send to Player" button only on the Tradable cards.

An earlier pass on this branch misread the report and went the other way, adding
Great Person and Civ to a new `isGiftable` predicate. That is reverted here.

## Scope

**In:**

- `tradeToPlayer` filters on `isTradable` again; the `isGiftable` superset is
  removed.
- The client's Give control is rendered only when `isTradable(item)` holds.
- Test coverage for both: the reducer refuses the non-Tradable kinds, and the
  control renders nothing for them.

**Out:**

- Widening what may be given away. The human explicitly does not want Great
  Person, Civ or City-state to be giftable; the old `Tradable` set is the rule.
- Loot. It already uses `isTradable`; unchanged.
- The `@types/node` fix, which is unrelated but needed to keep
  `pnpm -r typecheck` green on `main` and is kept from the earlier pass.

## Reference

`old-civ-rest/src/main/java/.../model/Tradable.java` is the old marker
interface, implemented by Culture I/II/III, Hut and Village;
`PlayerAction.tradeToPlayer` filters on it. The old client's "Send to Player"
button is included only by the culture/hut/village sections of
`useritems.html`, so hiding the control for everything else is the faithful
behaviour.

## Approach

- `packages/engine/src/item.ts`: `isGiftable` removed; the `isTradable` comment
  notes that it is the gate for both loot and give.
- `packages/engine/src/actions/player.ts`: `tradeToPlayer` filters `isTradable`.
- `packages/web/src/views/GameView.tsx`: the select+button is extracted into an
  exported `GiveControl` that returns `null` unless `isTradable(item)`.
- Tests: engine trade test over the non-Tradable kinds; a `GiveControl` component
  test that a Great Person, Civ and City-state render nothing.
- Docs: `decisions.md` (a correction entry superseding the earlier one),
  `README.md` "Deliberate improvements", `state.md`.

## Claimed paths

- `docs/agents/tasks/gift-greatperson-civ.md`
- `docs/agents/task-board.md`
- `packages/engine/src/item.ts` (`isTradable` comment only)
- `packages/engine/src/actions/player.ts` (`tradeToPlayer` filter and comment only)
- `packages/engine/package.json` (`@types/node` devDependency only)
- `pnpm-lock.yaml`
- `packages/engine/test/player-action.test.ts` (trade tests only)
- `packages/engine/test/draw-action.test.ts` (a loot regression test only)
- `packages/web/src/views/GameView.tsx` (`GiveControl` only)
- `packages/web/src/views/GiveControl.test.tsx` (new)
- `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`

## Acceptance criteria

- [ ] A Great Person, Civ, City-state or Wonder cannot be traded: the reducer
      returns `ITEM_NOT_FOUND`.
- [ ] Culture I/II/III, Hut and Village can still be given away.
- [ ] The hand shows no Give control for a Great Person, Civ or City-state.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: the control is built from the viewer's own hand only;
      no opponent hand is read or exposed.
- [ ] Verified in the browser / against a running server: a Great Person, Civ
      and City-state card show no Give control, a Hut/Village/Culture card does.

## Open questions

None. The human settled the direction: only the `Tradable` set is giftable.
