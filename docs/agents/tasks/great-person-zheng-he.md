# Zheng He: look under the hut and village tokens

- **Slug:** `great-person-zheng-he` · **Branch:** `feat/zheng-he` · **Owner:** Claude Code (Sonnet 5.5) · **Status:** in progress

## Goal

Issue #301. Zheng He (Any Time): "You may discard this card to look under every hut and village token on the
map and/or owned by other players."

The human's proposal (Norwegian, paraphrased): the player gets a list in their private log saying what every hut
and village token on the map is, at which square, and what the huts and villages the other players hold are, one
entry per token. The important part is that the draws are predefined: if huts or villages are shuffled for some
reason (an undo), Zheng He's player must be told about every new hut and village the shuffle gave.

## Scope

**In:**

- Playing Zheng He discards the card and writes one private log line per map token (square label and name) and
  one per hut or village item in another player's hand (holder and name). A public line says only that the player
  looked under the tokens.
- What was seen stays true. Each map hut or village piece without an identity is given one: the first hut or
  village of the deck is taken out of `state.items` and put under the piece (`GameState.underTokens`). The deck
  is thereby no longer the source of those tokens: a shuffle (item undo, Frida) cannot change what lies under a
  token Zheng He's player has seen, so no re-notification is needed. A token already under a piece keeps it.
- A draw of huts or villages first releases every identity whose piece is gone from the map (collected into an
  area or removed): the item goes to the top of its sheet in the deck, so the next Draw gives what the player saw.
  Draws never take an item that is under a piece still on the map.
- Undoing Zheng He: the card returns to the hand; the identities it created that are still under a piece go back
  into the deck and the huts and villages sheets are shuffled twice (so what the player saw is worth nothing),
  and a private line says so. Identities already released to a draw stay where they went.
- Another player's views never carry `underTokens`, the effect or the names.

**Out:**

- Placing the hut or village pieces on the map stays manual and anonymous. A token placed after the look has no
  identity until someone draws (as today).
- No new web UI: the private log already shows the lines. A map overlay is a later nicety.
- Tokens in a player's area (collected, not yet drawn) have no identity; only items count as owned tokens.

## Reference

`assisted-cards.ts` (`automate`, `playCard.apply`/`reverse`), `actions/draw.ts` (`draw`), `actions/undo.ts`
(`returnToDeck` shuffles the whole deck), `assisted-culture.ts` (`shuffleSheetTwice`), `blockade.ts`
(`mapCellOf`), `build-options.ts` (`squareLabel`), `state.ts` (`toPlayerView` is a whitelist), `card-timing.ts`
(`AUTOMATIC_EFFECTS`).

## Approach

- `packages/engine/src/zheng-he.ts` (new): `UnderToken { pieceId; item }`, `mapTokensOf(state)` (hut/village
  pieces on a map square, ordered by row then column), `bindTokens(state)` (give identities, returns the state
  and the new bindings), `releaseLooseTokens(state)` (identities whose piece left the map), `lookUnderTokens`
  (the private lines), `putBackTokens` (undo).
- `state.ts`: optional `underTokens` on `GameState`; `playCard` effect field `zhengHe: { bound: UnderToken[] }`.
- `assisted-cards.ts`: `Zheng He` case in `automate`, undo in `reverse`; the private lines are separate log
  entries, so `Automated` gets `privateLines`.
- `draw.ts`: `draw` calls `releaseLooseTokens` for HUTS and VILLAGES, and the draw skips nothing else because the
  bound items are not in `state.items`.
- `card-timing.ts`: `Zheng He` in `AUTOMATIC_EFFECTS`.

## Claimed paths

- `packages/engine/src/zheng-he.ts`, `assisted-cards.ts`, `state.ts`, `card-timing.ts`, `actions/draw.ts`
- `packages/engine/test/great-person-zheng-he.test.ts`, server API test, `docs/agents/*`

## Acceptance criteria

- [ ] Playing Zheng He lists every map hut and village (square, name) and every opponent hut and village, one
      private line each, and discards the card.
- [ ] The same tokens give the same items when collected and drawn, also after an item undo shuffled the deck.
- [ ] Draws of huts/villages by others never take an item under a token on the map.
- [ ] Undo returns the card, puts the still-bound items back, shuffles the two sheets, says so privately.
- [ ] A deck with fewer items than tokens, no tokens at all and no opponent tokens read sensibly.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: no projection (own, opponent, spectator) carries `underTokens` or the names; test
      added.
- [ ] Browser check: play Zheng He in the browser and read the private log.

## Open questions

None blocking. Decision to record: tokens are set aside under the pieces instead of read from the top of the
deck, because a draw takes the top card whichever token was collected.
