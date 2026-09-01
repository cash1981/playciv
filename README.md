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

## Kjøre appen

Krever Node 20 eller nyere og pnpm.

```bash
pnpm install
```

Start API-et i ett terminalvindu:

```bash
pnpm --filter @civ/server dev
```

Og klienten i et annet:

```bash
pnpm --filter @civ/web dev
```

Klienten ligger på http://localhost:5173 og proxyer `/api` til serveren på
port 8787. Registrer en bruker, opprett et spill, og la de andre spillerne bli
med — spillet starter av seg selv når siste plass er fylt.

Sett `TOKEN_SECRET` før du starter serveren hvis innloggingene skal overleve en
omstart. Uten den lages en tilfeldig hemmelighet per oppstart.

```bash
pnpm -r test
```

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
| `src/turn.ts` | `PlayerTurn.java` (og `TurnKey.java`, som aldri virket) |
| `src/undo.ts` | `Undo.java` |
| `src/actions/draw.ts` | `action/DrawAction.java` |
| `src/actions/player.ts` | `action/PlayerAction.java` |
| `src/actions/undo.ts` | `action/UndoAction.java` |
| `src/actions/turn.ts` | `action/TurnAction.java` |
| `src/actions/game.ts` | spilldelen av `action/GameAction.java` |
| `src/random.ts` | erstatter `Collections.shuffle` + `RandomUtils` |

### `packages/server`

Fastify over motoren. Java-motstykke: `resource/*` og `application/*` under
Dropwizard.

| Fil | Ansvar |
| --- | --- |
| `src/routes/auth.ts` | `AuthResource` — registrering og innlogging |
| `src/routes/games.ts` | `GameResource` — opprett, list, bli med, trekk seg, avslutt, logg, chat |
| `src/routes/play.ts` | `DrawResource` + `PlayerResource` — trekk, kamp, tech, avsløring, handel, tur, undo |
| `src/errors.ts` | `EngineError` → HTTP-status |
| `src/auth.ts` | scrypt-passord og HMAC-signerte bearer-tokens |
| `src/store/` | lagringsgrensesnittet og JSON-fil-implementasjonen |

Serveren har ingen spillregler. Hver rute henter tilstanden, kaller én ren
funksjon fra motoren, lagrer resultatet og svarer med `toPlayerView(state, deg)`.
En rute kan derfor ikke lekke andres hånd selv om den ville.

Miljøvariabler: `PORT` (8787), `HOST`, `DATA_FILE`, `TOKEN_SECRET`, `CORS_ORIGIN`.

### `packages/web`

React + Vite. Erstatter AngularJS-appen i `old-civ-web`. Bevisst nøktern —
grafikken kommer senere. Dekker innlogging, spillisten, og spillsiden med hånd,
trekk, kamp, teknologi, sosialpolitikk, turordrer, logg, undo-avstemning og chat.

Klienten importerer typene sine fra `@civ/engine`, så den kan ikke komme i
utakt med hva serveren faktisk sender.

## Lagring i stedet for MongoDB

`packages/server/src/store/types.ts` definerer et `Repository`. Den eneste
implementasjonen i dag er `JsonFileRepository`: alt ligger i `Map`-er i minnet og
speiles til `packages/server/data/civ.json` etter hver endring — debounced, og
atomisk via en midlertidig fil som byttes inn.

Det holder til å spille lokalt, og spill overlever en omstart. Det er ikke en
database: ingen indekser, ingen samtidighetskontroll, ingen spørringer. En
Mongo-implementasjon kan legges ved siden av uten at rutene endres.

Slett `packages/server/data/civ.json` for å nullstille alt.

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

**Undo dispatcher på `logType`, ikke på delstrenger i loggteksten.**
`UndoAction.putDrawnItemBackInPBF` avgjorde hva som skulle skje ved å lete etter
`"discarded"`, `"drew"` og `"barbarian"` i logglinjen. Loggposten har en
`logType` som bærer samme informasjon. Javas barbar-gren var uansett død kode:
den krevde `"drew"`, men barbarlogger skriver `"has drawn"`, og de har heller
ikke noe item knyttet til seg, så undo kunne aldri initieres for dem.

**Fem turfase-metoder ble én.** `updateSOT`, `updateTrade`, `updateCM`,
`updateMovement` og `updateResearch` skilte seg bare i e-postteksten og
logtypen. Fasen sto allerede i DTO-en, så `updateSOT` med `phase: "trade"`
skrev til handelsfasen men logget SOT. `updateTurn` tar fasen som argument.

**Lesinger muterer ikke lenger.** `getRemaingTechsForPlayer` gjorde
`techs.removeAll(...)` på listen fra Mongo, og `getAllPublicTurns` strippet
historikk ved å endre de lagrede objektene. Begge er nå rene projeksjoner.

**`addNewTurn` lagrer.** Java glemte `pbfCollection.updateById`, så den nye
turen forsvant ved neste lesing.

**Sosialpolitikk beholder sitt `itemNumber`.** Java lagde et nytt objekt med bare
navn og bakside, som ga `itemNumber` 0. Logglinjen bruker nummeret til å gi hver
spiller sitt eget referansenummer, så med 0 fikk alle kort samme nummer og
funksjonen var virkningsløs.

**Fargevalg er deterministisk.** `chooseColorForPlayer` tok første element ut av
et `HashSet`, altså i uspesifisert rekkefølge. Nå følges rekkefølgen Green,
Yellow, Purple, Red, Blue.

**`endTurn` lar fortsatt hvem som helst avslutte turen.** Java fant spilleren som
har turen og ga den videre uten å se på hvem som kalte. Det er portert som-er,
siden autorisasjonen lå i ressurslaget; server-pakken må håndheve det.

## Utsatt

- **Ekte MongoDB.** Erstattet av JSON-fil bak `Repository`, se over.
- **Grafikk og hex-brett.** Klienten er tekst og knapper. Kortbildene under
  `Civilization/Moderator/` er ikke tatt i bruk; `itemImage()` i motoren gir
  allerede filnavnene.
- **Highscore og turneringer** — `GameAction.getCivHighscore`,
  `getPlayerHighScore`, `TournamentAction`. Spør på tvers av spill og trenger et
  ordentlig datalag.
- **E-postvarsling** — `email/SendEmail`, samt `/newpassword` og
  `/verify/{playerId}` i `AuthResource`. Java startet en rå `new Thread(...)` per
  varsel.
- **`AdminAction`** — bytt bruker i et spill, slett spill, masseutsending.
- **Sanntid.** Klienten henter på nytt etter hver handling; ingen websocket.
  `todo.txt` i old-civ-rest ønsket seg det for chat.

### Sikkerhet

Autentiseringen er på utviklingsnivå: scrypt-hashede passord og HMAC-signerte
bearer-tokens som ikke kan trekkes tilbake før de utløper. Java brukte usaltet
SHA-1 og HTTP Basic, så det er en forbedring, men det er ikke gjennomgått for
produksjon.

### Krever en beslutning

`revealItem` for en sivilisasjon trekker startenheter gjennom
`DrawAction.draw`, som krever at det er spillerens tur. Konsekvensen i Java er at
bare spilleren som har turen kan avsløre sin sivilisasjon — de tre andre får 403
under oppsettet. Det ser ut som en feil, men er portert som-er fordi Java er
fasit og ingen gammel test dekker det. Dokumentert i
`test/player-action.test.ts`, testen «en spiller som ikke har turen kan ikke
avsløre sin sivilisasjon».

Referansemateriale — regelbøker, kart i ODP/PPTX, kortgrafikk og en kopi av
Mongo-databasen — ligger i `Civilization/`, som er utenfor git.
