# Issue #6 — reveal a social policy, with its WaW artwork

- **Slug:** `issue-6-reveal-social-policy`
- **Branch:** `fix/6-reveal-social-policy` (off `main`)
- **Owner:** coder, orchestrated by Opus
- **Status:** in progress
- **GitHub:** https://github.com/cash1981/playciv/issues/6

## Goal

A player can reveal a social policy they have chosen, the way techs and items
are revealed: the chosen policy shows in the social-policy section as a card
with its WaW artwork, hidden until the player reveals it, and revealing writes a
public log line. The section stays visible after choosing.

## Why

Issue #6: "You should be able to reveal your social policy. When you pick a
social policy it should be copied to your hand. There you should be able to
reveal it. Use the social policy images under the `Civilization\WaW` folder.
Also, when you choose a social policy, the section was removed. The section
should always stay put."

## What I traced

- **Engine.** `chooseSocialPolicy` (`player.ts:456`) adds the policy to
  `player.socialPolicies` with `hidden: true`. There is **no**
  `revealSocialPolicy` — only `revealTech` and `revealItem` exist. `revealTech`
  (`player.ts:113`) is the pattern to mirror: find in the player's list, set
  `hidden: false`, append a `REVEAL` item log.
- **Server.** Tech reveal is `POST /api/games/:id/techs/reveal` calling
  `revealTech` (`play.ts:196`). Social policy has `chooseSocialPolicy` and a GET
  list but no reveal route.
- **Client.** `TechPanel.tsx` shows `yourPolicies` (`view.you.socialPolicies`) as
  a plain `ul.list` of names — no images, no reveal button. `ItemCard.tsx`
  already renders an item as its card using `itemImage()`.
- **Images.** `itemImage()` for `socialpolicy` (`item.ts:412`, shared with
  hut/village/tech) returns `` `${name}.png` `` with spaces stripped — e.g.
  `NaturalReligion.png` (capitalised). The WaW files are **lower case**:
  `Civilization/WaW/` has `patronage.png`, `pacifism.png`, `rationalism.png`,
  `naturalreligion.png`, `organizedreligion.png`, `urbandevelopment.png`,
  `militarytradition.png`, `expansionism.png`. The eight policy names are
  Rationalism, Organized Religion, Expansionsim (a typo in the spreadsheet data),
  Patronage, Pacifism, Urban Development, Natural Religion, Military Tradition.
  Every name lower-cased with spaces removed matches a WaW file **except**
  `Expansionsim` → `expansionsim` while the file is `expansionism`.
- **Section stays put.** The social-policy section already renders
  unconditionally in `TechPanel`; the "section removed" symptom is the
  multi-column grid reflow, fixed separately in **issue #5** (`fix/5`,
  PR #11). Do not re-implement that here; this branch is off `main` and will
  read the section correctly once #5 is merged. Do not regress the section into
  a conditional render.

## Scope

**In:**
1. **Engine** `revealSocialPolicy(state, { playerId, name })` mirroring
   `revealTech`: find the chosen policy, set `hidden: false`, append a `REVEAL`
   log. Export from the barrel.
2. **Server** `POST /api/games/:id/socialpolicies/reveal` calling it, plus the
   `api.ts` client method `revealSocialPolicy(gameId, name)`.
3. **Images.** Give `socialpolicy` its own `itemImage` case returning
   `` `${name.toLowerCase().replace(/ /g, '')}.png` ``. Copy the eight WaW policy
   PNGs into `packages/web/public/items/` via `tools/item-assets.ps1`, and copy
   `expansionism.png` **also** as `expansionsim.png` so the spreadsheet typo
   resolves (an alias, like the existing ones in that script). Document the typo.
4. **Client.** In `TechPanel.tsx`, render `yourPolicies` as `ItemCard`s (so each
   shows its WaW image) with a **Reveal** button on the hidden ones (calling
   `api.revealSocialPolicy`), mirroring how the tech list offers Reveal. Keep the
   choose select/button working and the section always rendered.

**Out:**
- The "section stays put" layout fix — that is #5.
- A public per-player list of revealed policies (techs have
  `revealedTechsForAllPlayers`; social policies were not asked for that). The
  reveal log line makes the name public, which matches the issue.
- Changing tech/hut/village image mapping — only split `socialpolicy` out.

## Reference

- Java `PlayerAction.revealSocialPolicy` if present in
  `old-civ-rest/.../action/PlayerAction.java` — mirror it; if absent, mirror the
  in-repo `revealTech`, and note in `decisions.md` if it deviates.
- `revealTech` / the tech reveal route / the tech Reveal button are the working
  templates for each layer.

## Claimed paths

- `packages/engine/src/actions/player.ts` (revealSocialPolicy)
- `packages/engine/src/index.ts` (barrel, if needed)
- `packages/engine/src/item.ts` (socialpolicy image case)
- `packages/engine/test/` (reveal + hidden-info tests)
- `packages/server/src/routes/play.ts` (reveal route)
- `packages/web/src/lib/api.ts` (client method)
- `packages/web/src/views/TechPanel.tsx` (cards + reveal button)
- `tools/item-assets.ps1` (copy WaW policy images + alias)
- `packages/web/public/items/` (the copied PNGs — run the tool)

## Acceptance criteria

- [ ] `revealSocialPolicy` sets the chosen policy's `hidden` to false and logs a
      `REVEAL`; a policy the player has not chosen gives `ITEM_NOT_FOUND`. Engine
      test.
- [ ] A **hidden** social policy's name does not leak into another player's view;
      after reveal, the name appears in the public log. Extend
      `hidden-info.test.ts` (mirror the tech leak test).
- [ ] `itemImage()` for every one of the eight policies resolves to an existing
      file under `packages/web/public/items/` (including `Expansionsim` →
      `expansionsim.png`). A gamedata test asserting no missing artwork covers
      this — extend it, or add one.
- [ ] The social-policy section renders the chosen policies as cards with images
      and a Reveal button on hidden ones; the section is always present.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass. Report real output.

## Verification note

The orchestrator will run `tools/item-assets.ps1` and verify in the browser that
a chosen policy shows its WaW image and reveals. The coder should still add the
image files (run the tool) so typecheck/build see them, and report if the tool
cannot run.
