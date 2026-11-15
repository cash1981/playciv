# Tech cancellations and United Nations consent

- **Slug:** `tech-cancellations` · **Branch:** `feat/great-person-twain` · **Owner:** orchestrator · **Status:** in progress

## Goal

Writing, Civil Service and Mass Media cancel like Mark Twain: the game rewinds to before the target, the Spy is
spent, and a cancellation can be countered (redo) by the cards and techs that may stop it. The human's words:
"Writing kan kun stoppe en city action", "writing er resource ability, så den kan kanselleres som det", "du må ha
en spy ... fra en ressurs i hånda di eller fra et kultur kort som gir deg en spy", and the United Nations wonder
means culture events cannot target a player against their will, so its owner must be asked.

## Scope

**In:** a tech command on `POST /cancellations` (Spy chosen like any resource payment); who may cancel or counter
what (table below); the Cancel button in the log for the tech; resource abilities (every recorded tech ability that spent a resource) as targets of Twain,
Primetime TV and Mass Media, whose cost stays spent; United Nations consent when a culture event names
its owner (the player who plays the card confirms the owner agreed, logged).

**Out:** A real asynchronous approval request to the United Nations owner. A Spy that is only a board piece without an item.

## Reference

`decisions.md` "Cancellation"; `packages/engine/src/cancellation.ts`, `twain.ts`, `assisted-tech-abilities.ts`,
`assisted-resources.ts`. F&F wonder text: "Culture events cannot target you against your will."

| Cancels | Targets | Counters (latest event) |
| --- | --- | --- |
| Mark Twain | another player's city action, culture event or resource ability | an event of a culture card, a resource ability (tech) event; not another player's own Twain or King |
| Writing (Spy) | another player's city action | nothing |
| Civil Service (Spy) | a culture event | an event of a culture card |
| Mass Media (Spy) | a resource ability | a resource ability (tech) event |
| Jousting Tourney, Primetime TV | a culture event; Primetime also a resource ability | an event of a culture card; Primetime also a tech event |
| Bread and Circuses | a culture event aimed at you | nothing |

## Approach

Engine: `CancellationCommand` takes `itemId` or `tech` + `payment`; `CancellationEvent` gains `tech` and `payment`;
the Spy is spent with `spendResource` on the rewound state and the tech marked used for the turn; `canCancel` and
`canCounter` use the reaction's name. `cancellationView` lists `techCancels`. The old note-only Writing action is
refused. Culture play: `PlayCardPayload.consents`, `PlayableCard.unitedNations`.
Server: parse `tech`/`payment`/`consents`. Web: the tech buttons start the log's cancel mode.

## Claimed paths

- `packages/engine/src/cancellation.ts`, `united-nations.ts`, `assisted-tech-abilities.ts`, `assisted-cards.ts`,
  `assisted-core.ts`, `assisted-resources.ts`, `assisted.ts`, `card-timing.ts`
- `packages/server/src/routes/cancellation.ts`, `assisted-args.ts`
- `packages/web/src/views/LogPanel.tsx`, `AssistedActions.tsx`, `PlayableCards.tsx`, `packages/web/src/lib/cancelPick.ts`

## Acceptance criteria

- [ ] Each row of the table has an engine test; a counter of a tech event refunds the cancelled thing and still
  spends the Spy; a Spy from a culture card works.
- [ ] A recorded resource ability (Pottery, Horseback Riding) is cancelled by Twain, Primetime TV and Mass Media;
  its resources stay spent and the tech is used up; Writing and the culture cancellations are refused; a counter
  stands the ability again without spending anything twice
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: a Spy's identity is public only as the existing payment text says; the view lists only the viewer's techs
- [ ] Browser check: Writing cancels a city action in the log, with the later work undone

## Open questions

None blocking. The United Nations consent is the player's own confirmation, not an in-game request.
