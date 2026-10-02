# Culture hand size and Combat hand size

- **Slug:** `culture-hand-size`
- **Branch:** `feat/culture-hand-size`
- **Owner:** Claude (orchestrator; coder role)
- **Status:** in progress

## Goal

The Status table's "Trade, Coins & Culture cards" group gets a **Culture hand
size** column that the engine calculates, so nobody has to count the cards that
raise it. The existing "Hand Size" column under Modifier is renamed **Combat hand
size** and becomes free text (`+1`, `5+2`, ...).

## Why

The human: "I Trade, Coins & Culture cards seksjonen ønsker jeg å legge til en som
heter cards culture hand size. Den skal defaultes til 2. Den ikke være mindre enn 2."
and "The other Hand Size in the combat section I want you to rewrite to Combat
hand size. And it should be able to write +1 or +2 etc." Answers given in chat:
free text for Combat hand size; only revealed cards count (first for others,
then for the owner too); EFTA gives +1 from the first investment, nothing more.

## Scope

**In:**

- `cultureHandSize` on `PlayerStats`, derived on every read (like `combat`),
  never editable (`STAT_NOT_EDITABLE`).
- Rule: base 2, +1 Pottery, +1 Civil Service, +1 Theology, Computers +1 per 5
  coins (total of the Coins column, rounded down), Valmiki (Great Person) +2,
  EFTA investment (`stats.efta >= 1`) +1, owner of Cristo Redentor +4 (added after
  review, at the human's request). Never below 2.
- Revealed cards only, for the owner as well as everyone else (the human's later
  answer): a hidden tech or hidden Valmiki gives nothing to anyone. Valmiki's +2
  goes when the card is discarded. The coin total and `efta` are already public.
- `handSize` renamed `combatHandSize`, a string (trimmed, at most 20 characters,
  empty allowed). Old saves migrate (`handSize` 0 becomes empty, other numbers
  become their text).
- Web: new read-only column, renamed free-text column.

**Out:**

- Making Culture hand size editable (the human said it need not be).
- Applying the hand size anywhere else (drawing limits are not enforced).
- Higher EFTA levels: the table only shows Level I.

## Reference

No old-system equivalent: the old status sheet was typed by hand. The values are
from the human's table (screenshot in chat). Valmiki's card text: "Your culture
hand size is increased by 2."

## Approach

New `packages/engine/src/culture-hand.ts` with `cultureHandSizeOf(state, player)`. `withDerivedStats` and `opaque` in `state.ts` fill the stat.
`setPlayerStat`, the migration, the server route and `StatusPanel` follow the
rename.

## Claimed paths

- `packages/engine/src/culture-hand.ts`, `index.ts`, `state.ts`, `migrate.ts`, `actions/player.ts`
- `packages/engine/test/culture-hand-size.test.ts`, `player-stats.test.ts`
- `packages/server/src/routes/play.ts` (and its tests)
- `packages/web/src/views/StatusPanel.tsx` and `.test.tsx`, `packages/web/src/lib/api.ts`
- `README.md`, `docs/agents/decisions.md`, `docs/agents/state.md`

## Acceptance criteria

- [ ] Each source has a test: base, Pottery, Civil Service, Theology, Computers
      (0, 4, 5, 9, 10 coins), Valmiki, EFTA 0/1/3, and all together.
- [ ] Never below 2, even with negative coins or EFTA.
- [ ] Hidden information: neither the owner's nor an opponent's projection counts a
      hidden tech or a hidden Valmiki. Test in `culture-hand-size.test.ts`.
- [ ] Discarding Valmiki takes its +2 away again.
- [ ] `setPlayerStat` refuses `cultureHandSize`; `combatHandSize` accepts `+1`.
- [ ] Old saves with `handSize` load.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Verified in the browser: the new column and the renamed column.

## Open questions

None. Cristo Redentor was found in review and added on the human's answer.
