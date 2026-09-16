# Remove a chosen social policy

- **Slug:** `issue-16-remove-social-policy`
- **Branch:** `fix/issue-16-remove-social-policy`
- **Owner:** Luna
- **Status:** in progress

## Goal

A player can remove a social policy they chose, and the game log records that
removal.

## Why

Issue #16 explicitly asks to remove a chosen social policy and log its removal.

## Scope

**In:** Add the pure action, server route, typed API call, and UI control with
tests following the existing remove-tech pattern.

**Out:** Changing policy choice/reveal rules or other item types.

## Reference

`removeTech` in `packages/engine/src/actions/player.ts` and the corresponding
tech route/UI are the local patterns. This is a requested behavior not present
in the Java reference; record that deliberate extension in decisions/README if
the implementation confirms it is new.

## Approach

Remove by policy name after access validation, append a `REMOVED_SOCIAL_POLICY`
log entry, expose a POST route and API method, and add a Remove button beside
each owned policy.

## Claimed paths

- `packages/engine/src/actions/player.ts`
- `packages/engine/src/errors.ts`
- `packages/engine/src/log.ts`
- `packages/engine/test/player-action.test.ts`
- `packages/server/src/routes/play.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/TechPanel.tsx`

## Acceptance criteria

- [ ] A player can remove their own chosen policy by name.
- [ ] The removal is logged and the policy becomes available again.
- [ ] Another player cannot remove it.
- [ ] UI offers Remove and refreshes the view.
- [ ] Full typecheck, test, and build pass.

## Open questions

None; the requested behavior is explicit and follows remove-tech semantics.
