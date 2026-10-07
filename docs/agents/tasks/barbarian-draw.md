# Let players draw their own barbarians

- **Slug:** `barbarian-draw`
- **Branch:** `codex/barbarian-draw`
- **Owner:** Codex
- **Status:** in progress

## Goal

Every active game member can use a Draw barbarians button to draw their own
barbarian hand before a battle starts, without waiting for an opponent to choose
Barbarians. When an opponent starts that battle, reuse the left player's hand.

## Why

The human explicitly requested a Draw barbarians button and independent drawing
by the player on the left. The previous UI removal required the attacker to
initiate first; pre-drawn hands currently make initiateBattle fail.

## Scope

In: restore a member-only draw endpoint and typed client method, button in the
Barbarians section, reuse an existing barbarian hand when initiating, existing
automatic draw fallback, meaningful engine/API/UI tests and documentation.
Out: starting battles on behalf of another attacker, concurrent arenas, changes
to card selection/combat/seat-order rules, deployment or migrations.

## Reference

Current drawBarbarians reducer and initiateBattle/playerToLeft. Decisions for
issues #63 and #79 describe automatic drawing and removal of the manual button;
this intentionally supersedes the removal at the human's request. Current code
and tests are authoritative, old Java is historical lookup only.

## Approach

Expose POST /api/games/:gameId/battle/barbarians for the authenticated player,
with optimistic rev protection. Draw is available when no arena is active and
no barbarian hand is held; reject a live-arena draw to prevent replacing units
already referenced in the arena. Reuse pre-drawn left-controller units on
barbarian battle initiation; retain automatic draw when no units exist.

## Claimed paths

See task-board claim.

## Acceptance criteria

- Any game member, independently of phase-turn status, can draw their own existing three-unit selection.
- No targetPlayerId can draw someone else's hidden hand; spectators and withdrawn/nonmembers cannot draw.
- Draw button is unavailable with existing barbarians, an active arena, busy/read-only state or spectator view.
- Duplicate draws fail without deck/log/hand mutation; stale revisions fail without changes.
- Starting against Barbarians reuses existing left-player units, otherwise draws as today. Other seats/opponents cannot access private units.
- PvP initiation, controller assignment, defender-first arena turn and drawing/fallback rules remain unchanged.
- Engine/API/UI regressions, full workspace typecheck/test/build, independent review and rules check pass.
- Verify actual button behavior in a local browser with fake accounts.

## Open questions

None. Preserve automatic drawing for existing users while adding independent pre-drawing.
