# Undici security update

## Problem

The repository has seven open Dependabot alerts for transitive `undici` 7.29.0,
including a high-severity TLS certificate validation bypass. GitHub identifies
7.29.1 as the first patched 7.x release.

## Scope

Update the dependency lock to resolve `undici` to at least 7.29.1, keep the
update compatible with the current Wrangler/Miniflare toolchain, run the
repository checks, and prepare a pull request for the authorized merge.

## Acceptance and verification

- [x] `pnpm-lock.yaml` resolves `undici` to 7.29.1 through an override scoped to 7.29.0.
- [x] `pnpm -r typecheck` passes.
- [x] `pnpm -r test` passes: 895 engine, 608 server and 528 web tests.
- [x] `pnpm -r build` passes.
- [x] No unrelated dependency upgrades are included.
- [ ] Independent review passes; merge and confirm GitHub's Dependabot alerts clear.

## Handover

`pnpm why undici -r` confirms the installed dependency is 7.29.1 under
Miniflare/Wrangler. The update only changes the workspace override and lockfile
resolution. GitHub alert status can only be confirmed after the change reaches
the default branch and Dependabot refreshes its scan.
