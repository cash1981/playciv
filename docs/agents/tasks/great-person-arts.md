# Great Persons of the arts: Garcia, Lovelace, Kurosawa, Darwin

- **Slug:** `great-person-arts` · **Branch:** `feat/great-person-arts` · **Owner:** Claude Code (Sonnet 5.5) · **Status:** in progress

## Goal

Issue #301. The four Great Persons that build on Devote to the Arts apply through
the engine. The human: "Jerry Garcia og Ada Lovelace … De bygger på Devote to the
Arts", "Akira Kurosawa og Charles Darwin … knyttes til Devote to the Arts".

- **Jerry Garcia** (City Management, discard): devotes every city to the arts as the
  capital's city action; the other cities may still act.
- **Ada Lovelace** (City Management, discard): one extra city action with one city.
  Cannot be canceled; may be used for the capital during anarchy.
- **Akira Kurosawa** (faceup): each time another player devotes a city, the holder gains 1 culture.
- **Charles Darwin** (faceup): once per turn, when the holder devotes a city, all of the
  culture the city produced becomes trade 1:1.

## Scope

**In:** Garcia as a card play (culture from each city's estimate, one log line, the capital's
action counted); Lovelace as a credit that lets one city take a second action without the
"already acted" question; Kurosawa paid automatically on every Devote and on Garcia, undone with them;
Darwin as a checkbox on the Devote form, once a turn.

**Out:** Mark Twain's cancel (separate design, #301 comment); scouts' squares for Garcia's
all-city devote and Darwin on a Garcia play (no choice UI for them yet); enforcing anarchy.

## Reference

`assisted.ts` (`devoteToTheArts`), `assisted-core.ts` (`earlierCityActions`), `assisted-cards.ts`
(`automate`, `reverse`), `city-actions.ts`, `web/src/views/CityGather.tsx`, `server/src/routes/play.ts`
(`parseDevotePayload`). Card texts in `gamedata-faf-waw.json`.

## Approach

- New `assisted-arts.ts`: Kurosawa payments and their reversal, Darwin availability and conversion,
  Lovelace credits.
- `devoteToTheArts` effect gains `trade`, `kurosawa`, `usedAction`; payload gains `darwin`.
- `playCard` effect gains `garcia` and `kurosawa`; Garcia adds the culture through `gain`.
- `CityActionOptions` gains `extraAction` (an unspent Lovelace credit); `DevoteToTheArtsOption` gains `darwin`.

## Claimed paths

- `packages/engine/src/{assisted-arts,assisted,assisted-core,assisted-cards,card-timing,city-actions,state}.ts`
- `packages/engine/test/`
- `packages/server/src/routes/play.ts`, `packages/server/test/`
- `packages/web/src/views/{CityGather,CityCard,BuildPicker}.tsx` and their tests, `packages/web/src/lib/api.ts`
- `packages/engine/src/city-defence.ts` (exports `isCapital`)
- `docs/agents/`

## Acceptance criteria

- [ ] Each card has engine tests: effect, undo, repeat, wrong phase
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: no new field on the public view; `extraAction` and `darwin` are own view only
- [ ] Browser check: Darwin checkbox on a devote, Garcia play, Kurosawa gain in the holder's stats

## Open questions

None blocking.
