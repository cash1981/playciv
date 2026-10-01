# Battle summary: HP and combat bonus only, shown instantly

- **Slug:** `issue-216-battle-summary`
- **Branch:** `feat/issue-216-battle-summary`
- **Owner:** Claude (Sonnet 5.5)
- **Status:** in review

## Goal

The battle summary bar above the arena shows, per side, the label, the unit
count, the remaining HP and the combat bonus, for example `HP 1 (+4)`. ATK is no
longer shown there. When a player types a new HP for a unit, the summary changes
at once instead of after the save and the server round trip.

## Why

Issue #216, "Battle bugs?". The human: "What you really only need to track is the
combat bonus plus remaining HP. So you can remove the ATK and only have HP plus
the combat bonus shown as (+4) for instance." Asked what was wrong in the
screenshot, they answered that nothing was wrong, "it just took a while before
the right HP was shown". The delay is the 600 ms debounce on the HP field plus
the request, because the summary is computed on the server.

## Scope

**In:**

- `GameView.tsx`: remove the ATK span from the summary bar.
- `GameView.tsx`: the summary's HP total uses the HP currently typed in each
  living unit's field, falling back to the server value.

**Out:**

- `totalAttack` in `BattleSideSummary` and the ATK input on each unit stay
  (human's choice: display only).
- Automatic kill at 0 HP stays manual (issue #71).
- No change to the winner line logged at end battle; it reads server state.

## Reference

No counterpart in the old system. The old client has no HP display or winner
concept for battles (see `decisions.md`, issue #79).

## Approach

Client only. `GameView` keeps a map of unit id to the HP typed but not yet
confirmed by the server. `ArenaUnitCard` reports each keystroke and clears the
entry when the server's value for that unit arrives. A pure helper sums the
effective HP of the living units per side.

## Claimed paths

- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/BattlePanel.test.tsx`
- `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [x] The summary has no ATK text.
- [x] Typing a new HP changes the summary before any request is sent.
- [x] A killed unit does not count, with or without a draft.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [x] Hidden information: none involved; arena units are already public.
- [ ] Verified in the browser: type HP in an arena unit and watch the summary.

## Open questions

None.
