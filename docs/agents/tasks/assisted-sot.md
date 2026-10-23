# Assisted play: phase tabs and Start of Turn

- **Slug:** `assisted-sot` (part 9 of `assisted-play-contract`, same branch and PR #271 by the human's choice)
- **Branch:** `feat/assisted-play-contract`
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** in progress

## Goal

The action panel follows the turn. It has one tab per phase (Start of Turn, Trade,
City Management, Movement, Research) and each tab says what the player may do in that
phase, with a button per action and a visible reason when it cannot be pressed. Every
action already built moves under City Management. Start of Turn is the first phase
that gets new actions. Culture and Great Person cards that can be played at any time
show on every tab.

## Rules read (base rulebook p. 12 to 14 and 26 to 27, W&W, F&F, FAQ v2.0, tech sheet)

- Start of Turn: the player performs start of turn actions (wonders, culture cards),
  builds new cities and changes government. Order is the player's, and order matters.
- **New city** (base p. 13): fewer built cities than the maximum (2, 3 with Irrigation
  revealed); a scout in the square, which is sacrificed; not water; eight revealed
  squares around it; no hut or village token adjacent; no enemy figure adjacent;
  three or more squares from every other city (outskirts do not overlap), anyone's. W&W:
  a city may be built on a city-state square (it is destroyed, +3 culture) but not
  next to one; no city next to a relic (W&W/F&F). Zulu (civ sheet): may build next to
  huts and then explore them at once. Romans: advance one space for free on building a
  city. Republic: armies build cities like scouts.
- **Governments** (base p. 14, FAQ): switching to a government unlocked last turn or in
  this Start of Turn is free; any other switch goes through Anarchy, and from Anarchy
  any known government can be taken next Start of Turn. One switch per Start of Turn.
  Pyramids (all governments unlocked, immune to anarchy) and Martin Luther King avoid
  Anarchy. Democracy: SoT gain 2 trade. Fundamentalism: SoT gain 1 culture per army.
  Feudalism: SoT harvest a resource in the outskirts of one of your cities.
- **Social policies** (W&W p. 10, gamedata): each Start of Turn ability once per turn.
  Expansionism: 1 trade per city and per city-state you control. Pacifism: 1 culture,
  2 with a scout on the map. Patronage: spend 1 culture, draw a culture event of the
  level of your culture marker. Rationalism: spend 6 trade to learn a level I tech;
  spend 11 trade to learn a level II tech (learning is not researching: no coins kept,
  Japanese and Porcelain Tower discounts do not apply, FAQ on Archimedes).
- **Invest** (F&F p. 13): one coin per turn, at Start of Turn, only coin tokens (sheet
  and tech cards), never printed coins.
- **Scouts** (base p. 26): from the turn after it was placed a scout sends its square to
  one city, declared in Start of Turn; the icons count as that city's outskirts for the
  turn and the square's own city loses them (p. 27).
- **Culture cards** (card sheets): timing is the first words of the effect. Start of Turn
  and Any Time cards can be played in Start of Turn. A card with two timings is played
  for one of them.

## Decisions by the human (2026-10-23)

- Cards played: only a log line (who played what, who is targeted) and the discard. No
  effect on the target, because other players can cancel the card. A player picker
  chooses targets, so the log names them.
- Scouts: assigning only affects the production estimate (terrain) and the log. Trade,
  culture, coin and resource icons are not in the map data; those stay manual.
- Growing a capital into a metropolis (Agriculture) only scrolls to the map; the player
  does it by hand.
- Wonder, Great Person, hut, relic and tech Start of Turn abilities are in this slice.
- The base city and Anarchy defaults above are confirmed.

## Scope

In: the five tabs; the existing assisted actions under City Management; card play in
Start of Turn and any time; social policies, governments and investing; building a city
from a scout; scout assignment; the Start of Turn abilities of wonders, Great Persons,
huts, relics and techs. Each action is a button with a log line and an undo vote.

Out: automatic effects on other players, metropolis growth, free-build flows that need
a map square pick where the player can do it by hand (they log the claim), Movement,
Research and Trade actions beyond the tabs.

## Claimed paths

- `packages/engine/src/assisted.ts`, `assisted-core.ts`, `assisted-sot.ts`, `sot-*.ts`,
  `state.ts`, `errors.ts`, `index.ts`, `migrate.ts`, `actions/player.ts`, `actions/turn.ts`
- `packages/engine/test/assisted*.test.ts`, `sot*.test.ts`
- `packages/server/src/routes/play.ts`, `errors.ts`, `packages/server/test/assisted*.test.ts`
- `packages/web/src/lib/api.ts`, `views/AssistedActions.tsx`, `PhaseTabs.tsx`, `SotPanel.tsx`,
  `GameView.tsx`, `CitiesPanel.tsx`, `CityActions.tsx`, `styles.css` and tests
- `docs/agents/decisions.md`, `state.md`, `README.md`

## Acceptance criteria

- [ ] Five tabs; the viewer's current phase is selected first; any tab can be opened.
- [ ] City Management holds every action that exists today; none is visible elsewhere.
- [ ] Start of Turn lists each action with a button, a status and a reason.
- [ ] A culture or Great Person card playable now has an enabled Play button in the tab
      and in the hand; play discards the card and logs the targets; undo by vote.
- [ ] Hidden information: another player's view carries nothing of the hand.
- [ ] Each new action: a test for ready, wrong phase, used and undo.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build`
