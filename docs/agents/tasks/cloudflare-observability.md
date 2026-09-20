# Keep Cloudflare observability in Wrangler

- **Slug:** `cloudflare-observability`
- **Branch:** `chore/cloudflare-observability`
- **Owner:** Codex
- **Status:** in progress

## Goal

The Worker observability settings shown in the Cloudflare dashboard are
declared completely in `wrangler.jsonc`, so a later deploy cannot silently
replace them with different defaults.

## Why

Cloudflare reports: "Update your wrangler config to ensure settings are
consistent." The dashboard supplied the exact logs and traces configuration to
persist in source control.

## Scope

**In:**

- Replace the abbreviated observability setting with the complete dashboard-
  supplied logs and traces configuration.
- Validate the Wrangler configuration with a dry-run deployment.

**Out:**

- Deploying the Worker or changing the current production version; the human
  will deploy the reviewed configuration through the normal release flow.
- Application logging, tracing instrumentation, or retention-policy changes.

## Reference

This is Cloudflare deployment configuration and has no Java or AngularJS
counterpart. The exact values come from the Cloudflare dashboard prompt quoted
by the human.

## Approach

Expand `observability` in `wrangler.jsonc` to declare enabled, fully sampled,
persistent invocation logs and explicitly disabled traces with their supplied
sampling and persistence values.

## Claimed paths

- `wrangler.jsonc`
- `docs/agents/tasks/cloudflare-observability.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] `wrangler.jsonc` contains the dashboard-supplied `logs` and `traces`
      settings exactly.
- [ ] `pnpm --filter @civ/worker dry-run` accepts the configuration.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: not applicable; no application data or projection is
      changed.
- [ ] Browser verification: not applicable; this is deploy configuration only.

## Open questions

None.
