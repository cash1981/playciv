# Another player's turn-order text bleeding into your own

- **Slug:** `turn-order-draft-bleed`
- **Branch:** `fix/turn-order-draft-bleed`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

Reading another player's turn orders must never change what the signed-in
player sees (or saves) in their own tab. Today, opening another player's tab
and then returning to your own makes that player's text appear in your own
phase editors for the same turn and phase.

## Why

Reported from a live game: *"Når man trykker på en annen spiller sin turn order
for å se hva de har skrevet, også trykker man tilbake på sin egen, så smitter
den andre spillerens tekst over på din egen."* The signed-in player's editors
then show the other player's orders, "Save all changes" would publish them onto
the signed-in player's turn, and "Unsaved changes" is shown for text nobody
typed on that tab.

This is a client-side state bug, not a rules bug. The old system has no
equivalent screen (turn orders were a single list), so the reference is the
current TypeScript.

## Scope

**In:**

- Ensure only the signed-in player's own, editable workspace records turn-order
  drafts and live-dirty markers, so a read-only opponent editor can never write
  the signed-in player's draft.
- Regression test: switching away from and back to your own tab keeps your text.

**Out:**

- Changing `MarkdownEditor`'s read-only emission. An editor can be read-only
  only transiently on the signed-in player's own tab (while a save or another
  action is in flight), and suppressing its changes there would risk dropping
  the final keystrokes. The ownership check belongs in `TurnPanel`, which knows
  whose orders are shown.
- Any change to what the server sends for another player's turn orders
  (revealing rules, projection) — untouched.
- The private log — it is a single signed-in-player surface and is not part of
  the bug.
- Reworking the draft model or the save reconciliation — out of scope; the
  existing model is kept.

## Reference

No old-system counterpart. `old-civ-web` had one combined "all orders" view and
no per-player tabs, so there is nothing to port. The current `TurnPanel.tsx`
draft bookkeeping is the reference.

## Approach

One invariant, currently violated: **`TurnPanel`** keys drafts and live-dirty
markers by `${turnNumber}:${phase}` with no player, and wires `onPhaseChange` /
`onPhaseDirty` for whichever player tab is showing. Guard both handlers so only
the signed-in player's own workspace writes them; another player's read-only
orders never become your draft. A read-only editor may still report a change —
it flushes its document through `onChange` on unmount, and Crepe can serialize
that document differently from the value it was given — but the handler now
ignores it because the workspace is not the signed-in player's own.

## Claimed paths

- `packages/web/src/views/TurnPanel.tsx`
- `packages/web/src/views/TurnPanel.test.tsx`
- `docs/agents/tasks/turn-order-draft-bleed.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] Switching to another player's tab and back to your own leaves your own
      phase text unchanged.
- [ ] A read-only opponent editor cannot write a draft or a live-dirty marker,
      so "Save all changes" never sends another player's text.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: a read-only opponent editor cannot write a draft, so
      it cannot be submitted as the signed-in player's orders; covered by the
      regression test.
- [ ] Verified in the browser: <to fill in>

## Open questions

None.
