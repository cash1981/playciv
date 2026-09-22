# Hide a revealed turn-order version that is already in the editor

- **Slug:** `turn-history-hide-current`
- **Branch:** `feat/turn-history-hide-current`
- **Owner:** orchestrator (DeepSeek V4.1 Flash); implementation by the `coder` role
- **Status:** in progress

## Goal

When a turn-order phase's revealed history contains a version identical to the
text currently in that phase's editor, that version is not drawn again above the
editor. Earlier versions that differ from the editor text are still drawn, so a
timeline still shows the changes the player actually made. From the player's
side: revealing an order they have not edited since no longer prints the same
text twice, once struck through and once normal.

## Why

Owner request, verbatim: *"If you have not made changes to your turn orders,
there is no need to show history. Like this example screenshot shows, there is 1
start of turn reveal. there is no need to show the history when it is written in
the textbox."*

The screenshot showed the Start of turn phase with one reveal whose text was
identical to the editor content, so the same line appeared twice.

## Scope

**In:**

- `packages/web/src/views/TurnPanel.tsx`: filter the rendered history per phase.
- `packages/web/src/views/TurnPanel.test.tsx`: cover the hidden and kept cases.

**Out:**

- **The engine and the stored history.** `TurnOrderVersion` still records every
  reveal; the data is the public record and the reveal state depends on it. Only
  the rendering changes.
- **CSS and layout.** An absent list already reserves no space; no new class.
- **A "show history" toggle.** The owner asked for the duplicate to be gone, not
  for a control to bring it back.

## Reference

The reveal history is new in issue #125 and has no old-system counterpart
(`old-civ-rest`'s `TurnAction` kept saved orders as a plain deduplicated list and
`old-civ-web` did not render it). There is therefore no Java/AngularJS rule to
match; this is a presentation decision by the owner. `rules-checker` has nothing
to check.

## Approach

Extract the revealed-version list in `TurnOrderWorkspace` into a small
`TurnHistory` component that receives the phase, its versions, and the current
editor markdown. It drops every version whose `markdown` equals the current
editor text, using the same exact string equality the panel already uses for
"unchanged" (`values[phase] !== savedValues[phase]`). If nothing is left, it
renders nothing.

Equality rather than "only the newest entry": any version identical to what is
on screen is redundant, and an older version can equal the current text again
after the player reverts. The compared value is `values[phase]`, which is
exactly what the editor holds (the own draft, or the read-only order for another
player).

## Claimed paths

- `packages/web/src/views/TurnPanel.tsx`
- `packages/web/src/views/TurnPanel.test.tsx`
- `docs/agents/tasks/turn-history-hide-current.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`

## Acceptance criteria

- [ ] A phase whose only revealed version equals the editor text renders no
      history list and no struck-through duplicate.
- [ ] A phase with an older version that differs still renders that older
      version and its timestamp above the editor; only matching versions hide.
- [ ] The existing "oldest-first above the editor" test still passes (its two
      versions differ from the editor text).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: unchanged. The filter reads only the viewer's own
      projected `values`/`current`; no field, projection or wire shape changes,
      so nothing new can leak.
- [ ] Verified in the browser: a phase with one reveal equal to its editor shows
      no history, and a phase with an earlier differing reveal shows only that
      one.

## Open questions

None. The reading taken is the literal one: hide a version whose text is
identical to the editor's current text. If the owner instead meant "hide the
whole list whenever the text matches the newest reveal", that is a one-line
change to the same filter and can follow as a correction.
