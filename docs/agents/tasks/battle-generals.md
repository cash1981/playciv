# Battle generals: Zhukov and Gustavus Adolphus

- **Slug:** `battle-generals` · **Branch:** `feat/battle-generals` (stacked on `feat/battle-cards`, PR #331) · **Owner:** Claude (Sonnet 5.5) · **Status:** in progress

## Goal

Issue #301. The human on Gustavus: "Når man spiller den så discardes alle units, og man får lov å velge samme antall nye og de som er unlocked." Zhukov: no ruling; the card text is used.

## Scope

**In:** Zhukov ("Each time one of your units is killed during a battle, deal 1 wound to an enemy unit of your choice") and
Gustavus Adolphus ("discard at the start of a battle: kill all units in your battle force, they cannot be saved, and
build an equal number of unlocked units for free, adding them to your battle force").

**Out:** Nikola Tesla, Mark Twain, Dr. Martin Luther King (later PRs).

## Reference

decisions.md "Battle Great Persons"; `battle-cards.ts`, `actions/arena.ts`, `assisted-cards.ts`.

## Approach

Zhukov: played (revealed, kept) in a battle; `Battle.zhukov` holds `{playerId, base, dealt}`; wounds owed = own killed
units now minus `base` minus `dealt`; `zhukovWound` arena action (`POST /battle/arena/zhukov`) hits a living enemy unit
for 1 (0 HP = killed). Gustavus: `playCard` with `units` (one sheet per unit of the battle force); the player's living
arena units are killed (`ArenaUnit.gustavus`, so Nightingale cannot save them), unplaced battlehand units are discarded,
the same number of unit cards of the chosen types (aircraft only with Flight) are drawn into hand and battlehand.

## Claimed paths

- `packages/engine/src/{battle,battle-cards,gustavus,state,card-timing,assisted-cards,assisted-core}.ts`, `packages/engine/src/actions/arena.ts`
- `packages/server/src/routes/{arena,assisted-args}.ts`, `packages/web/src/views/{GameView,PlayableCards}.tsx`, `packages/web/src/lib/api.ts`
- `docs/agents/{decisions,limitations,state}.md`

## Acceptance criteria

- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: discarded and drawn unit cards stay in the player's own log; the effect record is never projected
- [ ] Browser check: Gustavus form and Zhukov wound buttons
