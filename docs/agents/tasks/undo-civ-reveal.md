# Undo a civilization reveal

- **Slug:** `undo-civ-reveal`
- **Branch:** `claude/vote-undo-civ-reveal-ecozon`
- **Owner:** Claude
- **Status:** in review

## Goal

A player who revealed the wrong civilization can ask for an undo, and the table
votes on it like any other undo. When it passes, everything the reveal handed
out by itself goes back: starting units, Egypt's own wonder, the starting tile
and leader marker, the discarded civ cards, the starting tech, the government,
and, if the reveal completed the table, the start-of-game wonder deal. A later
reveal then does it all again, including the wonder deal once everyone has a civ.

## Why

Human: "Er det mulig å implementere vote for å undo reveal av Civ? […] units,
wonder som Egypt eller great person som America (hvis dette blir trukket
automatisk) gå tilbake til stacken. […] Jeg vet ikke hva man skal gjøre dersom
de har drawn kultur kort eller andre ting, kanskje best å la de bli i hånden.
Kun det som automatisk tildeles bør rulles tilbake."

## Scope

**In:**

- A record of what a civ reveal handed out, kept on its REVEAL log entry.
- `vote` runs the rollback when a civ REVEAL undo is accepted.
- Reveals made before this change have no record; a rebuild from the log and board covers them unless Egypt or the shared wonders are involved.

**Out:**

- Anything the player drew or chose themselves (culture cards, techs, other
  units): it stays in the hand.
- Great Person at reveal: nothing in the engine draws one automatically today
  (America's starting cards are not dealt), so there is nothing to return.

## Reference

`decisions.md` → "Arena and card handling" (undo is a vote on a log entry).
`revealCivilization` in `actions/player.ts`, `putItemBack` in `actions/undo.ts`.

## Approach

`GameLogEntry.civSetup` records the ids and pieces the reveal produced.
`actions/undo.ts` branches on it in `vote`; the server hides "Ask for undo"
for reveals with no record.

## Claimed paths

See [task-board.md](../task-board.md).
