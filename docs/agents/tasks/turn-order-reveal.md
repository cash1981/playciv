# Turn-order reveal buttons

- **Slug:** `turn-order-reveal`
- **Branch:** `fix/turn-order-reveal`
- **Owner:** Codex
- **Status:** in progress

## Goal

Each of the five turn-order editors has a reveal button. A player can keep an
order private while planning and publish that phase explicitly; other players
see only the phases that have been revealed.

## Why

The current port publishes every saved phase immediately. The requested hotfix
is to let players reveal SOT, TRADE, CM, MOVEMENT and RESEARCH independently.

## Scope

**In:**

- Add per-phase reveal state to turn orders, with migration for existing games.
- Add a pure, authorized engine action and API endpoint to reveal one phase.
- Add a reveal button and public/private rendering in the turn-order panel.
- Add engine, server and web regression tests.

**Out:**

- Hiding the player's own orders from themselves.
- Un-revealing an order after publication.
- Changing lock/save behaviour or notification wording beyond the new reveal action.

## Reference

The old Java/client implementation publishes orders on save and has no reveal
control. This is an explicitly requested behaviour change; no old reference
exists for the new reveal state.

## Approach

Extend `PlayerTurn` with a per-phase revealed map. Saves retain the order in
the owner's private turn, but public projections mask unrevealed order text and
history. A dedicated engine action updates the owner's turn and the public
copy, and the server exposes it through the existing play routes. The React
panel places the button beside each phase heading and disables it when the
phase is empty, already revealed, not owned, or read-only.

## Claimed paths

- `packages/engine/src/turn.ts`
- `packages/engine/src/actions/turn.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/src/state.ts`
- `packages/engine/test/turn-action.test.ts`
- `packages/server/src/routes/play.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/TurnPanel.tsx`
- `packages/web/src/views/TurnPanel.test.tsx`
- `README.md`
- `docs/agents/decisions.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] Each phase has a reveal button beside its heading.
- [ ] Saving an order does not publish it; clicking reveal publishes only that phase.
- [ ] An opponent cannot reveal another player's phase through the API.
- [ ] Existing saved orders remain visible after migration.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: unrevealed order text and history are absent from public-turn responses.
- [ ] Verified in the browser: a private phase stays hidden and becomes visible after clicking Reveal.

## Open questions

None.
