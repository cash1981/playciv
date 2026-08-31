# Civilization: The Board Game — play by forum

Omskriving av play-by-forum-motoren for Sid Meier's Civilization: The Board Game
(Fantasy Flight Games), med utvidelsene *Fame and Fortune* og
*Wisdom and Warfare*.

Erstatter to gamle repoer:

| Gammelt | Stack | Erstattes av |
| --- | --- | --- |
| `old-civ-rest` | Java 8, Dropwizard 0.8, MongoDB/MongoJack, Apache POI | `packages/engine` + `packages/server` |
| `old-civ-web` | AngularJS 1, Bootstrap, Grunt/Bower | `packages/web` |

Den gamle løsningen kjørte på playciv.com og viste brettet gjennom en Google
Presentation og et Google Spreadsheet i iframe (`mapLink` / `assetLink`). Det er
borte, og er ikke portert. Et ekte hex-brett kommer senere.

## Oppsett

```bash
pnpm install
```

```bash
pnpm -r test
```

Krever Node 20 eller nyere og pnpm.

## Pakker

### `packages/engine`

Ren domenelogikk. Ingen HTTP, ingen database, ingen UI. Alle reducere er rene
funksjoner:

```ts
(state: GameState, action: DrawInput) => Result<GameState, EngineError>
```

Ingenting kaster. De gamle Java-actionene kastet `WebApplicationException` med
HTTP-status rett fra domenelogikken; her er feil verdier, og HTTP-mapping hører
i server-pakken.

Tilfeldighet ligger i tilstanden som en seed (`state.rng`), så et spill kan
reproduseres og spilles om. Java brukte `Collections.shuffle` mot en global
kilde.

| Fil | Portert fra |
| --- | --- |
| `src/sheet-name.ts` | `SheetName.java` |
| `src/item.ts` | `Item` + subtypene `Civ`, `Unit`, `Tech`, `Wonder`, `Hut`, `Village`, … |
| `src/state.ts` | `PBF.java`, `Playerhand.java` |
| `src/log.ts` | `GameLog.java`, `GameLogAction.java` |
| `src/gamedata.ts` | `excel/ItemReader.java`, uten Apache POI |
| `src/create-game.ts` | `PBFTestAction.createNewGame` |
| `src/actions/draw.ts` | `action/DrawAction.java` |
| `src/random.ts` | erstatter `Collections.shuffle` + `RandomUtils` |

### `packages/server`, `packages/web`

Tomme placeholders. Ikke startet.

## Spilldata

`packages/engine/data/gamedata-faf-waw.json` er autogenerert fra
`old-civ-rest/src/main/resources/assets/gamedata-faf-waw.xlsx`:

```bash
pnpm --filter @civ/engine gamedata
```

`tools/xlsx-to-json.ps1` leser xlsx-en direkte som zip + XML via .NET, uten
Apache POI. JSON-en er en rå celle-dump, ikke tolket spilldata, og gjengir
POIs `Cell.toString()` med vilje — inkludert at numeriske celler blir `"12.0"`
og at formelceller blir `"RAND()"`. Det er nettopp de særegenhetene
`ItemReader.java` filtrerte på, så en trofast port trenger dem.

Regenerer JSON-en hvis regnearket endres. Ikke rediger den for hånd.

## Skjult informasjon

Det gamle systemet lagret hele det trukne kortet på loggdokumentet i Mongo og
lot ressurslaget filtrere. `todo.txt` i old-civ-rest kaller det et
sikkerhetshull, og løsningen var punktvise fikser.

Her ligger skillet i typene:

- `GameLogEntry.item` og `.privateLog` er full informasjon.
- `toPublicLog(entry)` gir en `PublicLogEntry` uten dem.
- `toPlayerView(state, viewerId)` gir egen hånd i klartekst, motstandernes
  hender som antall, stokken som antall, og andres loggposter kun i offentlig
  form.

Dekket av `packages/engine/test/hidden-info.test.ts`.

## Kjente avvik fra Java

De gamle testene er fasit. Der Java og en forventning var uenige, vant Java.

**Reshuffle henter ikke fra spillernes hender.** `DrawAction.reshuffleItems`
legger kun tilbake det som ligger i `pbf.discardedItems`, og bare for typene i
`SHUFFLABLE_ITEMS`: units, great person, kulturkort I–III og civ. Huts,
villages, tiles, bystater og wonders kan ikke reshuffles i det hele tatt — Java
kastet `IllegalArgumentException`, motoren gir `NOT_SHUFFLABLE`.
`ItemReader.redrawableItems` var bygget for å hente tilbake fra hender, men ble
aldri brukt noe sted. Se `sheet-name.test.ts` og `draw-action.test.ts`.

**Units har alltid nivå 0.** `setLevel` kalles ingen steder i old-civ-rest.
Nivåtabellene (Spearmen, Pikemen, Riflemen, Modern Infantry og motpartene for
Artillery og Mounted) er portert fordi `revealPublic` og `revealAll` grener på
dem, men de er uten effekt til oppgradering av units implementeres.

**Kolonne A og bare kolonne A.** `columnIndexZeroPredicate` betyr at
unit-arkene leses kun fra første kolonne. Kolonne B–D inneholder statistikk for
oppgraderte nivåer og er aldri lest.

**Inkonsistente bildefilnavn er beholdt.** `Civ` fjerner ikke mellomrom mens
alle andre gjør det, kulturkort stripper utropstegn, great person prefikses med
`klein`, og bystater bruker `description` og ikke `name`. Filnavnene på disk
under `Civilization/Moderator/` følger disse reglene, så de er ikke ryddet.

**Doble mellomrom i loggen er beholdt.** Java skrev
`username + " drew " + " - " + …`. Tekstene er sammenlignbare data og de gamle
testene matcher på dem.

## Bevisste forbedringer

**Stabil `id` per item-instans.** Java identifiserte items med verdi-likhet
(`@EqualsAndHashCode` på navn/beskrivelse/type), som betød at to identiske
`Infantry 1.3` var «like» og `discardedItems.remove(item)` kunne fjerne feil
instans. Hvert item har nå en ugjennomsiktig id. `itemNumber` er beholdt for
loggkompatibilitet, og startoffset er fortsatt tilfeldig per spill så nummeret
ikke avslører hvilket kort det er. `itemValueEquals` finnes fortsatt der
Java-semantikken trengs.

**Space Flight er ikke en singleton.** Java hadde `Tech.SPACE_FLIGHT` som
statisk felt — delt muterbar tilstand mellom alle spill i samme JVM.

## Utsatt

Ikke portert i denne runden, i grov prioritetsrekkefølge:

- `PlayerAction` — velg civ, velg tech, avslør, kast, handel mellom spillere
- `UndoAction` — avstemning om undo
- `TurnAction`, `PlayerTurn`, `TurnKey` — turfaser
- `GameAction` — opprett spill, bli med, trekk seg, vinner
- `TournamentAction`, highscore
- Chat
- Persistens (`packages/server`) og autentisering
- Klient (`packages/web`)
- Hex-brett og grafikk

Referansemateriale — regelbøker, kart i ODP/PPTX, kortgrafikk og en kopi av
Mongo-databasen — ligger i `Civilization/`, som er utenfor git.
