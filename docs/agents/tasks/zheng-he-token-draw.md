# Zheng He follow-up: draw a hut or village from a chosen token

- **Slug:** `zheng-he-token-draw` · **Branch:** `wt/zheng-he-draw`, pushed to `feat/zheng-he` (PR #330) · **Owner:** Claude Code (Sonnet 5.5) · **Status:** in progress

## Goal

The human played Zheng He, then pressed Draw Hut with a figure standing on a hut whose token was still on the map,
and drew an unrelated Wheat instead of the Silk Zheng He had shown: the item under a token is only given once its
piece has left the map. Quote: "Jeg foreslår kanskje at når man trykker draw hut/village så spør den fra hvilket område på kartet? ... Bør ha muligheten til velge random også tilfelle det er noe kort (f.eks village marker)". And: "La brikken stå. Det kan de gjøre manuelt." Second point: "Kanskje man burde få en warning dersom man discarder en great person som man ikke har trykket play på? For det kan jo hende den blir drept".

## Scope

**In:**

- Draw Hut and Draw Village, when a hut or village piece of that kind lies on a map square, ask where from: one
  button per square (e.g. J6) or "Not from a token on the map" (a card, a village marker). The token stays on the map.
- The engine: `DrawInput.fromPieceId` gives the item under that piece (top card when nobody has looked); `notFromToken`
  draws as today but never an item under a piece; neither (old clients) keeps the release of an item under a piece
  that has left the map. A separate public line says where the draw was from.
- Discard on a Great Person card in the hand asks first: it does not use the card, Play does.

**Out:** removing the piece (the human does that by hand); changing what Discard does.

## Reference

`actions/draw.ts`, `zheng-he.ts`, `routes/play.ts` (draw), `web/src/views/GameView.tsx` (`DrawPanel`, item Discard).

## Claimed paths

`packages/engine/src/zheng-he.ts`, `actions/draw.ts`, `index.ts`; `packages/server/src/routes/play.ts`; `packages/web/src/lib/api.ts`, `views/GameView.tsx`; tests; docs.

## Acceptance criteria

- [ ] A draw from a bound piece gives its item, the piece stays; from an unbound piece gives the top card; not from a token never gives an item under a piece.
- [ ] A piece that is not a token of the sheet, or off the map, is refused.
- [ ] The picker only appears when such tokens exist; Discard of a Great Person asks first.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass; browser check of the picker and the warning.
