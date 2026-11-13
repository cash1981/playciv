# Monarchy obsolete marks the wonder disabled (#327)

- **Slug:** `monarchy-obsolete` · **Branch:** `feat/unit-tech-abilities` (PR 346) · **Owner:** orchestrator (Sonnet 5.5) · **Status:** in progress

## Goal

The human, 2026-11-13: "Monarchy trenger ikke bare å logge. Du kan sette 'disabled' på owner listen på den
wonderen som monarchy velger å obsolete." Monarchy's `obsolete` mode (Silk, City Management: obsolete 1
ancient wonder) must flip the chosen wonder to disabled, as the existing hand-made disable does
(`setWonderOwner` with `disable: true`, issue #306; see decisions.md around line 213: the owner is cleared,
the piece stays, it is drawn crossed out, its culture token is unaffected).

## Scope

**In:** Monarchy `obsolete` takes a wonder piece id in the payload; only an ANCIENT wonder (era data in
`wonder-data.ts`) that is on the board, owned by a player (the list the owner column shows) and not already
disabled; any player's wonder, own included. The engine disables it through the same board change and board
history as `setWonderOwner` (so replay and the board history show it), pays the Silk, logs it publicly naming
the wonder and its former owner, and the vote undo restores owner and flag exactly (refused with a reason if the
wonder's owner or disabled flag changed since; board Undo of that change alone refused as for other assisted
board changes, `isAssistedBoardChange`). With no eligible wonder the obsolete mode is refused with nothing spent
(the button keeps the kill mode). Web: in `obsolete` mode the picker lists the eligible wonders (name and owner)
and sends the piece id; reconcile the stale selection as the other pickers do. Update tests (engine, server
parser, web), decisions.md (Monarchy paragraph, drop "obsolete is only logged"), limitations.md.

**Out:** Gunpowder's "obsolete an ancient or medieval wonder" (the same mechanism; the human has not asked yet),
medieval wonders for Monarchy, anything about culture tokens.

## Claimed paths

`packages/engine/src/assisted-tech-abilities.ts`, `assisted-core.ts`, `state.ts`, `actions/board.ts` (only if
needed), `packages/engine/test/`, `packages/server/src/routes/assisted-args.ts`, `packages/server/test/`,
`packages/web/src/views/AssistedActions.tsx`, `packages/web/src/lib/api.ts` if needed, web tests next to them.

## Acceptance criteria

- [ ] Obsolete disables the wonder with undo and a regression test
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Browser check of the picker, if available
