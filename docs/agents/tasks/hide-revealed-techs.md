# Hide revealed techs from the Techs list

- **Slug:** `hide-revealed-techs`
- **Branch:** `feat/hide-revealed-techs`
- **Owner:** orchestrator (DeepSeek V4.1 Flash); implementation by the `coder` role
- **Status:** in progress

## Goal

In the Techs panel, a researched technology that has already been revealed no
longer has a row in the "Yours" list. It is still visible on the player's own
tech pyramid (and, once revealed, in the "Revealed by everyone" pyramids), so
the list only shows the still-hidden techs — the ones that still need the
Reveal and Remove controls.

## Why

The human asked for it directly:

> When researching and revealing, after research is revealed there is no point
> in having it there since you already can see it on the pyramid tech tree, like
> this image is showing. You can keep it in browser state until the next reload
> (after it has been revealed) and just remove the boxes.

The screenshot shows the "Yours" list with every row tagged `revealed` and a
`Remove` button. A revealed tech is already on the pyramid, so the row is
redundant. The human explicitly allows a browser-only removal — the tech stays
in the game state; only the row goes.

## Scope

**In:**

- Filter the "Yours" `<ul>` to techs whose `hidden` is true.
- Fix the list's empty-state line so it does not read "None chosen." when the
  player does have techs, all of them revealed.
- A focused client test for the two cases.

**Out:**

- Engine, server and route changes. `revealTech` / `removeTech` / `techsChosen`
  are untouched; the revealed tech is still persisted, it is only the row that
  goes.
- Social policies. They are not drawn on a pyramid, so the human's reason
  ("you already can see it on the pyramid tech tree") does not apply to them.
- The `TechTree` pyramid itself, which keeps showing all of the viewer's techs
  (hidden ones with the yellow border).

## Reference

The old client has no such list at all. `old-civ-web`'s
`UserItemController.putTechsInScope` builds only the pyramid (`chosenTechs1`
… `chosenTechs5`), and a tech was revealed from the log
(`GameController.revealTechFromLog` → `PlayerService.revealTech`). The "Yours"
list is an addition of this port; hiding its revealed rows moves it closer to
the old client. No game rule is involved.

## Approach

In `packages/web/src/views/TechPanel.tsx`:

- Derive `const hiddenTechs = yourTechs.filter((tech) => tech.hidden)`.
- Map `hiddenTechs` instead of `yourTechs` in the "Yours" `<ul>`. Because every
  row is now hidden, the `hidden` tag and `Reveal` button are unconditional and
  the `hidden ? … : …` branches go.
- Keep the heading count `yourTechs.length`: the heading describes the whole
  "Yours" section, whose pyramid still shows every tech.
- Empty state: `None chosen.` when `yourTechs.length === 0`, otherwise
  `All researched techs are revealed.` when `hiddenTechs.length === 0`.
- Add `TechPanel.test.tsx`, rendering the panel statically with a `view` whose
  `you.techsChosen` mixes one hidden and one revealed tech, and assert the list
  shows only the hidden one.

## Claimed paths

- `packages/web/src/views/TechPanel.tsx`
- `packages/web/src/views/TechPanel.test.tsx` (new)
- `docs/agents/tasks/hide-revealed-techs.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] A revealed tech (`hidden: false`) has no row in the "Yours" list.
- [ ] A hidden tech still has its row with the `hidden` tag, `Reveal` and
      `Remove` buttons.
- [ ] The player's pyramid still renders the revealed tech.
- [ ] The empty-state line is `None chosen.` only when no tech is researched,
      and `All researched techs are revealed.` when all of them are revealed.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: no engine projection is touched, so nothing new can
      leak; the test only reads the viewer's own `techsChosen`.
- [ ] Verified in the browser: no browser is connected to this session, so the
      visual pass is left to the human.

## Open questions

None. The human's instruction is explicit; the only judgement call is that a
revealed tech loses its `Remove` button with the row, which the request implies
("just remove the boxes").
