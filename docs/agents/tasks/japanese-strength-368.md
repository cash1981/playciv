# Japanese infantry +1 strength (#368)

- **Slug:** `japanese-strength-368` · **Branch:** `feat/civ-abilities-romans-chinese-spain` · **Owner:** orchestrator + coder · **Status:** claimed

## Goal

Human, 2026-11-24: "Japan er minst ved å la de få en ekstra slagstyrke", in the same branch. Civ card: "Japanese infantry units have
+1 in strength". The base game (W&W "Strength and Health") defines strength as the wounds a unit deals, which is `ArenaUnit.attack`.

## Scope

**In:** a Japanese player's infantry card, when put into the arena, deals one more wound at every level (rotation), for both the
attacker and the defender. The arena shows it in the unit's label and the placement log line.
**Out:** the Japanese research discount (3 trade), which needs its own decision. Units of other kinds and other civilizations. A
barbarian unit a Japanese player controls (it is not their army). Hand-edited attack values stay the player's: an edit wins.

## Reference

`engine/src/actions/arena.ts`: `placeUnitInArena` (the client sends the printed attack; the engine builds the `ArenaUnit`),
`rotateArenaUnit` (reseeds attack and health from the printed values plus `rotationLevel`), `arenaUnitTier` (the label the web
shows, and the heal ceiling), `updateArenaUnit` (hand edit). `engine/src/battle.ts`: `ArenaUnit`. Metalworking adds +3 on top by
`attack + 3` and needs no change. Existing `combat-bonus.ts` is a per-player bonus for the whole side and the wrong place: this
is per unit.

## Approach

1. `ArenaUnit.attackBonus?: number` (optional, so saves and `migrate.ts` need nothing): the strength the unit's civilization adds,
   set at placement.
2. A small helper `civilizationAttackBonus(player, unit)` (new `engine/src/civ-strength.ts`, exported from `index.ts`): `1` for
   the Japanese and `unit.kind === 'infantry'`, else `0`. Not for a barbarian-controlled unit.
3. `placeUnitInArena`: `attack = input.attack + bonus`, `attackBonus: bonus` only when it is above 0; the placement log line already
   prints `(attack/health)`, add " (+1 Japanese strength)" to it when the bonus applies.
4. `rotateArenaUnit`: reseeded attack includes `unit.attackBonus ?? 0`. `arenaUnitTier` attack includes it, so the label and the
   web read the same.
5. Docs: `decisions.md` (a short "Japanese strength (#368)" note under the civilization abilities: strength = attack, per unit,
   at placement, hand edit wins), `limitations.md` (remove "Japanese infantry +1 strength" from the not-automated list, keep the
   3 trade discount).
6. Tests (engine): Japanese infantry placed gets printed+1 as attacker and as defender; a Japanese mounted/artillery unit and a
   non-Japanese infantry do not; rotation keeps the bonus; `arenaUnitTier` includes it; a face-off result differs by the bonus
   (infantry trumps mounted: a 1-attack Japanese infantry now kills a 2-health mounted unit when it strikes first); a barbarian
   unit controlled by a Japanese player gets none; an old arena unit without `attackBonus` behaves as before; hand edit wins.

## Claimed paths

- `packages/engine/src/` (battle.ts, actions/arena.ts, civ-strength.ts, index.ts), `packages/engine/test/`, `docs/agents/decisions.md`,
  `docs/agents/limitations.md`

## Acceptance criteria

- [ ] A Japanese infantry unit in the arena has attack printed + 1 at every rotation
- [ ] No other unit or civilization changes
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: nothing new (arena units are public)
- [ ] Browser check: none unless the web needs a change (the label reads `arenaUnitTier`)
