# Player status details

- **Slug:** `player-status-details`
- **Branch:** `feat/player-status-details`
- **Owner:** Codex (GPT-5)
- **Status:** done

## Goal

The player status panel shows the shared bookkeeping that players need during a
game: existing editable economy/culture values, unit counts, combat and
movement modifiers, hand capacity, and the four requested technology/economy
modifiers. Obsolete hand, policy, technology, battlehand, barbarian, and VP
columns are no longer part of the panel.

## Why

The human asked for the status board to replace the old detail columns with
compact sections for units/cards, default modifiers, and EftA/Infra/MIC/PE.
These values belong on the shared status board and need sensible defaults for
new and migrated games.

## Scope

**In:**

- Expand the public player status values with the requested editable fields and
  defaults.
- Render grouped status-table headers and remove the requested obsolete columns.
- Keep all status values editable by game members through the existing endpoint.
- Document the layout/default decision and worktree cleanup rule.

**Out:**

- Game rules or unit upgrade mechanics; these are bookkeeping values only.
- Changing the private hand, battlehand, barbarian, tech, or policy data model.

## Reference

This is a new status-board presentation requested by the human. The existing
status board is documented in `docs/agents/decisions.md` under issue #43.

## Approach

Extend `PlayerStats` with the requested fields, merge defaults during migration
so older saved games remain valid, accept the expanded keys in the existing pure
reducer/API route, and render a single horizontally scrollable table with
grouped headers in `StatusPanel`.

## Claimed paths

- `packages/engine/src/state.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/src/actions/player.ts`
- `packages/engine/test/player-action.test.ts`
- `packages/server/src/routes/play.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/views/StatusPanel.tsx`
- `packages/web/src/styles.css`
- `docs/agents/tasks/player-status-details.md`
- `docs/agents/task-board.md`
- `docs/agents/workflow.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] Status removes Barbarians, Hand, Policies, Techs, Battlehand, and VP.
- [ ] Status includes editable Infantry/Artillery/Mounted, Stacking/Mvmt/Combat/Hand Size, and EftA/Infra/MIC/PE values with requested defaults.
- [ ] Existing games receive the new defaults without losing saved values.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser: grouped status sections are readable and horizontally scrollable.

## Open questions

None. The requested values are treated as shared editable bookkeeping fields,
consistent with the existing status board's design.
