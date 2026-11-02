# Battle cards: Leonidas, Joan of Arc, Florence Nightingale, Sun Tzu

- **Slug:** `battle-cards` · **Branch:** `feat/battle-cards` · **Owner:** Claude (Sonnet 5.5) · **Status:** in progress

## Goal

Issue #301. The human: "Leonidas kan spilles dersom man har mindre units enn motstanderen og man er i forsvar
(ikke angriper). Det krever ikke at Leonidas er faceup. Man kan avsløre Leonidas etter at alle units er spilt og
før kampen avsluttes". "Florence ... tilgjengelig i battlearena (battlehand) i tillegg til ha en play knapp ved seg
[...] også i city management og movement fasen".

## Scope

**In:** a Play button for battle Great Persons, in the Battle panel and in every phase tab while a battle is active;
Leonidas (+8 combat bonus), Joan of Arc (bonus = unspent culture), Florence Nightingale (killed units marked saved),
Sun Tzu (pay 3 trade, pass the battle turn, once per battle).

**Out:** Zhukov and Gustavus Adolphus (next PR); playing after End battle (use Undo end battle, then End battle again).

## Reference

decisions.md "Arena and card handling"; `assisted-cards.ts`, `actions/arena.ts`, `state.ts` (`summariesOf`).

## Approach

`Battle.cardBonuses` (public: who, card, amount), `ArenaUnit.saved`, `Battle.sunTzu` (player ids). A BATTLE card is
`ready` for a participant of the active battle when its own rule holds. `playCard` effect `battleCard` for undo.
Sun Tzu is an arena action (`POST /battle/arena/sun-tzu`), not a card play.

## Claimed paths

- `packages/engine/src/{battle,state,card-timing,assisted-cards,index}.ts`, `packages/engine/src/actions/arena.ts`
- `packages/server/src/routes/arena.ts`, `packages/web/src/views/{GameView,PlayableCards}.tsx`, `packages/web/src/lib/api.ts`
- `docs/agents/{decisions,limitations}.md`

## Acceptance criteria

- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: the battle is public; a card played in battle is public in the log only by name when it is revealed
- [ ] Browser check: Play button in the Battle panel and in a phase tab, bonus visible in the summary
