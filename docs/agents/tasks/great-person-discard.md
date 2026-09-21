# Discard a random great person of a type

- **Slug:** `great-person-discard`
- **Branch:** `feat/great-person-discard`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** done

## Goal

When a player holds two or more Great Person cards of the same type — two
Generals, say, because one of their Generals was killed — that player can
discard one of them at random instead of choosing. The hand area offers a
button per Great Person type the player holds **two or more** of; pressing one
picks a uniformly random card of that type from the player's hand and puts it on
the discard pile, with the ordinary public `DISCARD` log line.

## Why

The human asked for it directly:

> "Kan du implementer muligheten å discarde en random great person av en gitt
> type. F.eks hvis du har to general kort, og en av generalene dine blir drept,
> må du plukke et great person general kort og randomly dicarde det. Det blir
> litt samme mekanikk som looting der man randomly må velge en ressurs f.eks og
> gi den til en spiller, bare at her ønsker jeg å discarde det."

Clarified with the human before starting:

- The action always draws from the **acting player's own hand**.
- The control is offered **only for a type the player holds two or more of** —
  with exactly one, the player discards it by hand with the existing per-card
  discard, and the random pick has no meaning.
- No turn gating; it may be used any time, like Loot.
- It lives in the **"Your hand"** panel, next to the Loot controls.

## Scope

**In:**

- A pure engine reducer that discards a uniformly random Great Person of a
  chosen `type` from one player's own hand, consuming the seeded RNG and
  writing the existing public `DISCARD` log line.
- A new `NOTHING_TO_DISCARD` engine error for the guard case (no such type).
- A `POST /api/games/:gameId/greatperson/discard` route taking `{ type }`,
  acting as the signed-in player.
- A web API method and a hand-panel control that offers a button per Great
  Person type the viewer holds two or more of.
- Engine, server and web tests.

**Out:**

- Any coupling to the battle arena. "A General was killed" is tracked by hand
  on the board today, and this action is the manual follow-up; wiring the
  arena's kill toggle to a forced discard would reopen issue #75's decision
  (`docs/agents/decisions.md`) and is not asked for.
- Enforcing "two or more" in the engine. The engine accepts any non-empty
  match; the two-or-more rule is a UI affordance, because discarding the only
  one of a type is exactly what the per-card discard already does.
- Turn ownership, battle-result or winner rules. Loot has none; neither has
  this.

## Reference

No old-system counterpart. `PlayerAction.discardItem` in old-civ-rest discards
a **named** item by sheet/item number/name, and the old client offers only that
per-card discard; there is no random-by-type action in `old-civ-rest` or
`old-civ-web`. This mechanic is new and specified by the human, so per
`AGENTS.md` rule 2 it is recorded here and in `decisions.md` rather than
borrowed from the old code.

The random-pick-and-move shape is copied from the ported `loot` reducer
(`packages/engine/src/actions/draw.ts`), which also shuffles its candidates
with `state.rng` and appends the old log texts.

## Approach

**Engine** — `packages/engine/src/actions/player.ts`, beside `discardItem`:

```ts
export interface DiscardRandomGreatPersonInput {
  readonly playerId: string
  readonly type: string
}
export function discardRandomGreatPerson(
  state: GameState,
  input: DiscardRandomGreatPersonInput,
): ActionResult
```

It requires access to the acting player, collects `item.kind === 'greatperson'
&& item.type === input.type`, returns `NOTHING_TO_DISCARD` when the list is
empty, otherwise shuffles with `state.rng`, moves the first card to
`discardedItems` with `hidden: true` (as `discardItem` does) and logs
`DISCARD` through `appendItemLog`.

**Errors** — a new `NOTHING_TO_DISCARD` kind in `packages/engine/src/errors.ts`
with its `describeError` text, mapped to **404** in `packages/server/src/errors.ts`
(same status as `NOTHING_TO_LOOT`).

**Server** — `packages/server/src/routes/play.ts`: a body-taking POST so the
type string (which contains spaces, e.g. `Artist or Thinker`) needs no URL
encoding; the acting player is `currentPlayer(c).id`, so a member can only
discard from their own hand.

**Web** — `packages/web/src/lib/api.ts` gets
`discardGreatPerson(gameId, type)`; `GameView.tsx` gets an exported
`GreatPersonDiscardControls` rendered in `HandPanel` next to `LootControls`,
listing types with count ≥ 2.

## Claimed paths

- `docs/agents/tasks/great-person-discard.md`
- `docs/agents/task-board.md`
- `packages/engine/src/actions/player.ts`
- `packages/engine/src/errors.ts`
- `packages/engine/test/player-action.test.ts`
- `packages/server/src/errors.ts`
- `packages/server/src/routes/play.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/GreatPersonDiscardControls.test.tsx` (new)
- `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [x] The engine discards a uniformly random Great Person of the given type
      from the acting player's hand; fixed seeds select each candidate.
- [x] The discarded card lands in `discardedItems` and gets the public
      `DISCARD` log line; the remaining cards stay in hand.
- [x] An unknown/absent type returns `NOTHING_TO_DISCARD`, mapped to 404.
- [x] The route acts only on the signed-in player's own hand.
- [x] The hand control appears only for Great Person types held two or more
      times, and pressing a button discards one of that type.
- [x] Hidden information: the hand control is built only from the viewer's own
      hand; no opponent hand or private description is rendered or sent.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
      (engine 434, server 176, web 77).
- [ ] Verified in the browser: with two Generals in hand, a "Discard random
      General" button appears and discards exactly one. **Not done — no browser
      was connected to the session.** Verified against a running server instead:
      a hand of Artist-or-Thinker + two Generals offered only "General", and the
      route discarded one at random (Khalid ibn al-Walid), leaving the other
      General and the Artist-or-Thinker, with one public `DISCARD` line. The
      button's visibility and click are covered by the jsdom component tests.

## Open questions

None. The human settled ownership, the two-or-more gate, turn gating and
placement before work started.
