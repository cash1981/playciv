# Tech tree

- **Slug:** `tech-tree`
- **Branch:** `feat/tech-tree`
- **Owner:** unclaimed
- **Status:** ready

## Goal

Show technologies as the pyramid the AngularJS app used, instead of a flat
list. Your own pyramid shows everything you hold, including the starting
technology that came with your civilization. A second view shows one pyramid
per player containing only what each has published.

## Why

The human asked for it directly, and gave an example worth keeping:

> "Jeg ønsker også at du viser tech treet slik jeg også implemnterte det. F.eks
> om man velger å researche Pottery, så skal din starting tech vises sammen med
> pottery som level 1 tech."

and, on the public/private split:

> "Det er kun når man velger å publisere hva man har valgt at den skal vises i
> public, mens det skal være en kopi som kun du privat kan se."

## Scope

**In:**

- A pyramid component: five rows, 5 / 4 / 3 / 2 / 1 slots from level 1 up to
  level 5.
- A researched slot shows the technology name. An empty slot shows the trade
  cost for that level: 6, 11, 16, 21 for levels 1–4.
- **Your pyramid**: every technology in `you.techsChosen`, hidden or published,
  with the hidden ones marked as yours alone.
- **Everyone's pyramids**: one per player who has revealed a civilization,
  headed by the civilization name and tinted with the player's colour, showing
  published technologies only.
- Keep the existing choose / reveal / remove actions working.

**Out:**

- Enforcing trade costs or prerequisites. The engine does not model trade, and
  inventing the economy is out of bounds. The numbers are labels.
- Reordering or drag-and-drop inside the pyramid.

## Reference

- `old-civ-web/app/views/partials/techtree.html` — the markup. Level 5 is a
  single "Space Flight" cell at the apex, level 1 the widest row at the base.
- `old-civ-web/app/scripts/controllers/TechController.js` — `getChosenTech` and
  `getAvailableTech`. The slot counts per level are hard-coded there: 5, 4, 3,
  2, 1.
- `old-civ-web/app/styles/techtree.css` — `table.tech-pyramid`, and the
  `fieldset.Red` / `.Purple` / `.Green` / `.Yellow` / `.Blue` colour blocks.
- Engine side: `revealedTechsForAllPlayers` in
  `packages/engine/src/actions/player.ts`, already exposed as
  `GET /api/games/:gameId/techs/revealed`.

## Approach

Mostly client work. Check first whether `revealedTechsForAllPlayers` includes
the starting technology — `revealCivilization` pushes it into `techsChosen`
with `hidden: false`, so it should already be there. **Verify before changing
the engine**; if it is there, this is a pure client change.

New `packages/web/src/views/TechTree.tsx` holding the pyramid, used twice in
`TechPanel.tsx`: once for your own techs, once per player for the public view.

## Claimed paths

- `packages/web/src/views/TechPanel.tsx`
- `packages/web/src/views/TechTree.tsx` (new)
- `packages/web/src/styles.css`
- `packages/engine/src/actions/player.ts` — only if the starting tech turns out
  to be missing from the public projection

## Acceptance criteria

- [ ] Five rows, 5 / 4 / 3 / 2 / 1 slots, level 1 at the base.
- [ ] Empty slots show 6 / 11 / 16 / 21 for levels 1–4.
- [ ] Your starting technology appears in your pyramid at level 1, alongside
      anything you have researched.
- [ ] A hidden technology appears in **your** pyramid and in **no other
      player's** public pyramid.
- [ ] Revealing a technology moves it into the public pyramid.
- [ ] A test proves a hidden technology's name does not appear in another
      player's view. Extend `packages/engine/test/hidden-info.test.ts`.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser with two players, one of whom has a hidden tech.

## Open questions

- The trade costs 6 / 11 / 16 / 21 come from the old client's tooltips. Level 5
  has no number there. Leave it blank unless the human says otherwise.
