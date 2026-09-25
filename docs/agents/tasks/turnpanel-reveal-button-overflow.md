# Turn phase heading row overflows the viewport at phone width

- **Slug:** `turnpanel-reveal-button-overflow`
- **Branch:** `fix/turnpanel-reveal-button-overflow`
- **Owner:** Claude (orchestrator, direct)
- **Status:** done

## Goal

On a game page at phone width, each Turn orders phase heading (its label,
save-status badge, Save button, and Reveal/Save & reveal/Revealed button)
fits within the viewport instead of pushing content past the right edge.

## Why

Found while browser-verifying an unrelated branch (issues #177/#176) at a
375px-wide mobile viewport: a "Reveal" button measured with its right edge
at ~428px in a 375px-wide viewport (`document.documentElement.scrollWidth`
428 vs `clientWidth` 375). Confirmed independent of that branch — it
reproduces identically on unmodified `main`, on the lobby-adjacent game page,
with no relation to that branch's Navigation/board changes. It is a plain
pre-existing horizontal-overflow bug, filed here as its own fix rather than
folded into the unrelated PR.

## Scope

**In:**

- `.turn-phase-heading` (`packages/web/src/views/TurnPanel.css`): the row
  holding the phase `<h3>`, `SaveStatusBadge`, "Save" button and
  "Reveal"/"Save & reveal"/"Revealed" button is `display: flex` with no
  `flex-wrap`, so at phone width the four items are forced onto one line
  that overflows the page rather than wrapping.

**Out:**

- Any other pre-existing responsive issue in this file or elsewhere — this
  fixes exactly the reproduced overflow, not a general mobile audit.
- `.turn-phase-actions`, a CSS class defined in `TurnPanel.css` with no
  matching class in `TurnPanel.tsx` (dead CSS, unrelated to this bug) — left
  alone; removing dead CSS is a separate, unrelated cleanup.

## Reference

Presentational-only CSS bug, not a rules question — no old-system
counterpart to check.

## Approach

Add `flex-wrap: wrap` to the existing `.turn-phase-heading` rule in
`TurnPanel.css` (unconditional, not inside the file's `max-width: 600px`
block — wrapping when content is too long is strictly an improvement at any
width, never a regression at a wide one). Verify live in the browser at
375px width, on a game page with at least one phase whose heading row
previously overflowed, that `document.documentElement.scrollWidth` equals
`clientWidth` and the row visually wraps instead of clipping/overflowing.

## Claimed paths

- `packages/web/src/views/TurnPanel.css`

## Acceptance criteria

- [x] At a 375px-wide viewport, on a game page's Turn orders panel, no
      phase heading row (label + badge + Save + Reveal) extends past the
      viewport's right edge.
- [x] `document.documentElement.scrollWidth === document.documentElement.clientWidth`
      at that width, verified live against a game with an unrevealed turn
      order phase (so the "Reveal" — not "Revealed" — button renders).
      Measured 428 vs 375 before, 375 vs 375 after.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: none — CSS-only, no projection change.
- [x] Verified in the browser: 375px width, live measurement plus a
      screenshot showing "Start of turn" wrap to a second line and "Trade"
      stay on one line. Read-only review (approved, no findings above a
      nit) confirmed by CSS reasoning that `flex-wrap` is a no-op wherever
      content already fits on one line, so no separate wide-width check was
      needed beyond that reasoning.

## Open questions

None — a contained, unambiguous CSS fix.
