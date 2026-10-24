# Spectator read-only controls

- **Slug:** `spectator-readonly`
- **Branch:** `fix/spectator-readonly`
- **Owner:** opencode (orchestrator/coder)
- **Status:** ready for review

## Goal

A viewer without a player seat in the game (a spectator, signed in or not) sees the
game but cannot press any control that writes. The Battle panel, Social policy
panel and board stop offering actions; previously a press answered with the
server's "missing bearer token" error.

## Why

The human reported: "spectators should not be able to draw barbarians, draw
battlehand or start a battle. Although I get error message, those buttons should be
disabled. Same with choosing social policies. Pieces and the entire board should be
readonly as well if it is possible. Better than getting the 'missing bearer token'
error message."

## Scope

**In:**

- `packages/web/src/views/GameView.tsx`: pass `readOnly` to `BattlePanel`,
  `SocialPolicyPanel` and `BoardView` when `view.you === null` (as well as replay and
  locked games).
- `packages/web/src/views/GameView.tsx` (`BattlePanel`): disable Draw battlehand,
  Reveal, Draw barbarians, Discard, Start battle, End battle/Undo, Place, arena
  moves, Rotate and the ATK/HP fields for a spectator or a read-only view.
- `packages/web/src/views/SocialPolicyPanel.tsx`: add a `readOnly` prop and disable
  the policy select, Choose, Reveal and Remove.
- `packages/web/src/views/BoardView.tsx`: keep the existing `readOnly` behaviour
  (no palette, drag, drop, nudge, Undo/Redo, piece buttons) when the viewer has no
  seat. Add a prop so a spectator does not get the replay dashed outline; replay and
  locked games keep it.
- Tests for the disabled controls and the GameView wiring.
- `docs/agents/decisions.md`, `docs/agents/state.md`, this brief.

**Out:**

- Server authorization rules. The server keeps refusing writes without a token;
  this change only stops the browser from offering them.
- New spectator features, hidden-information changes, or mutation rules.

## Reference

Current decisions: "Assisted play" and the action panel rules. Current code:
`GameView.tsx` (`BattlePanel`, `DrawPanel`, panel wiring), `SocialPolicyPanel.tsx`,
`BoardView.tsx`. `DrawPanel`, `StatusPanel` and `WondersPanel` already disable
themselves for a spectator.

## Approach

- `BattlePanel` and `SocialPolicyPanel` take an optional `readOnly` prop, default
  false. Their mutation handlers also refuse when `view.you === null`, so a
  spectator is safe even if a caller forgets the prop.
- `GameView` passes `readOnly={displayedView.you === null || replaying || locked}`
  to Battle, Social policy and the board.
- `BoardView` already has `readOnly`; add `showReadOnlyOutline` (default true) and
  pass `replaying || locked` from GameView, so the spectator board is not outlined
  like a replay.

## Claimed paths

- `packages/web/src/views/GameView.tsx`, `GameView.test.tsx`
- `packages/web/src/views/BattlePanel.test.tsx`
- `packages/web/src/views/SocialPolicyPanel.tsx`, `SocialPolicyPanel.test.tsx`
- `packages/web/src/views/BoardView.tsx`, `BoardView.test.tsx`
- `docs/agents/decisions.md`, `state.md`, this brief

## Acceptance criteria

- [x] A spectator cannot press Draw battlehand, Draw barbarians or Start battle.
- [x] A spectator cannot choose, reveal or remove a social policy.
- [x] A spectator cannot select, drag, rotate, remove or undo anything on the board,
      including pieces in a player area.
- [x] A spectator cannot rotate an arena unit or edit its ATK/HP fields.
- [x] The spectator board has no replay dashed outline; replay/locked still do.
- [x] A player's controls are unchanged.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: no projection changes; existing hidden-info tests pass.
- [x] Verified in the browser: spectator battle, social policy and board.

## Handover

Validation: `pnpm -r typecheck && pnpm -r test && pnpm -r build` passed. The web
tests cover the disabled Battle and Social policy controls, the arena Rotate and
ATK/HP fields, the GameView wiring, and the board's read-only outline/message. Checked in a headless browser against
the running dev server: a spectator sees Draw battlehand, Draw barbarians, Start
battle, Discard, the battle opponent picker, the social policy picker and Choose
disabled; the board has no replay outline and the palette says "Viewing — only
players can change the board." After merge, keep the durable rationale in
`decisions.md` and retire this brief in a later change.
