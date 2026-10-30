# Disband figures for caravans and fortifications; city defence bonus

- **Slug:** `disband-figures` · **Branch:** `feat/disband-figures` · **Owner:** Claude (Opus 5.5) · **Status:** in progress

## Goal

Fame and Fortune p. 7–8 disbanding, with the human's rulings (2026-10-30):

- A scout or army that travels onto a centre square of the player's own city
  may be disbanded there: the move asks first. A scout leaves a caravan marker,
  an army a fortification marker, on the city centre. One marker per city
  (either kind); when the city already has one, the figure is only removed.
- Travel only (`travelFigure`); movement cards and manual drag do not ask.
- Caravan: the city's next Build adds +2 production and uses the caravan up.
  Devote to the Arts and Harvest keep it. Undoing the build puts it back.
- City defence in battle, derived from the board: when an attacker's army
  stands on a centre square of a defender's city, the defender gets +6 (city)
  or +12 (capital, metropolis), +4 walled, +2 metropolis (F&F p. 9), +2
  fortification (base p. 23, F&F p. 7). The fortification marker is removed
  when the battle is ended, whoever won (human). Undo of End battle puts it back.

## Scope

**In:** engine, server travel route, web move prompt, Build production text,
Battle panel city bonus line, decisions and limitations.

**Out:** +3 hand size when defending a city (human: later); the shared pool of
15 fortification/caravan markers; disbanding by movement cards or drag.

## Approach

- `engine/src/disband.ts`: marker ids, `cityMarkerOf`, `disbandOfferAt`.
- `board.ts`: a `disband` board change (figure removed, marker placed) so board
  Undo takes the disband back in one step and the move in the next.
- `actions/board.ts` `travelFigure({ disband: true })`; server route passes it.
- `city-production.ts` `caravan`; `build-options.ts` adds 2; `assisted.ts`
  build removes the caravan and its undo restores it (`effect.caravan`).
- `city-defence.ts`: the defended city and its bonus parts; `battleSummaries`
  adds it to the defender's `combatBonus` and exposes `cityDefence`.
- `actions/arena.ts`: End battle removes the fortification;
  `endedBattle.fortification` lets Undo end battle restore it.

## Claimed paths

- `packages/engine/src/{disband,city-defence,board,battle,state,city-production,build-options,assisted}.ts`, `packages/engine/src/actions/{board,arena}.ts`
- `packages/server/src/routes/board.ts`, `packages/web/src/lib/api.ts`, `packages/web/src/views/{BoardView,GameView}.tsx`
- `docs/agents/decisions.md`, `docs/agents/limitations.md`

## Acceptance criteria

- [ ] Disband by travel: caravan/fortification placed, second marker refused silently (figure only removed), not on outskirts, not another's city, board Undo restores
- [ ] Build in a caravan city: +2 production, caravan removed, undo restores
- [ ] Battle: city/capital/walls/metropolis/fortification bonus derived; end removes fortification; undo end battle restores
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: only public board pieces are read; no new private data
- [ ] Browser check: move prompt and Build/Battle text
