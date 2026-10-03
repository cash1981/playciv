# Admin broadcast queue: 50 mails a day

- **Slug:** `broadcast-queue`
- **Branch:** `fix/broadcast-batching` (second slice, same PR as `broadcast-batching`)
- **Owner:** orchestrator (Claude); implementation by the `coder` role
- **Status:** claimed
- **Depends on:** slice 1, `docs/agents/tasks/broadcast-batching.md` (batch sending, bisect on 4xx, budget, `exclude`). Reuse that code; do not copy it.

## Goal

An admin queues a broadcast once. A daily scheduled job sends the next 50
pending recipients until everyone has had it, with no manual step and no
duplicates, and the admin can see progress, send the next batch early, or cancel.

## Why

Resend's free plan allows 100 mails a day, shared with the game mails (your
turn, chat, ...). A first broadcast on 2026-10-03 reached 49 of 555 accounts.
506 are left and the owner does not want to pay for Resend Pro, so the rest goes
out at 50 a day, about 11 days. Doing that by hand means pasting an exclude list
every day; the owner chose an automatic daily job, at **17:00 UTC**.

## Scope

**In:**

1. **D1 migration `packages/worker/migrations/0005_broadcast_queue.sql`**
   (the folder already has two `0004_*` files; take the next free number, 0005):
   - `broadcast(id TEXT PRIMARY KEY, subject TEXT NOT NULL, markdown TEXT NOT NULL,
     include_unsubscribed INTEGER NOT NULL DEFAULT 0, per_run INTEGER NOT NULL,
     status TEXT NOT NULL, created_at TEXT NOT NULL, last_run_at TEXT)`;
     status is `active`, `done` or `cancelled`.
   - `broadcast_recipient(broadcast_id TEXT NOT NULL, player_id TEXT NOT NULL,
     email TEXT NOT NULL, status TEXT NOT NULL, sent_at TEXT, error TEXT,
     PRIMARY KEY (broadcast_id, player_id))`; status is `pending`, `sending`,
     `sent` or `failed`. Add an index on `(broadcast_id, status)`.
2. **Repository.** Add the methods to `store/types.ts` and implement them in both
   `D1Repository` (`store/d1.ts`) and `JsonFileRepository` (`store/json-file.ts`):
   create a broadcast with its recipients in one step; find the active broadcast;
   claim the next N pending recipients (set them `sending` in one guarded
   statement or one `batch()`, so two overlapping runs cannot claim the same
   rows); mark recipients `sent` or `failed` with an error; release claimed
   rows back to `pending` when a run stops before sending them; set the
   broadcast status and `last_run_at`; read the counts per status. Follow the
   repository's existing patterns, including the shared test suite.
3. **Notifications.** `Notifications.queueBroadcast(options)` snapshots the
   eligible accounts at queue time (same classification as the direct broadcast:
   no address, unsubscribed unless included, excluded, invalid-looking address)
   and refuses with a 409-style error when a broadcast is already `active`.
   `Notifications.runQueuedBroadcast(now)` takes the active broadcast, claims up
   to `per_run` pending recipients, and sends them with the **same batch
   sender** as slice 1 (one provider request for 50, bisect on a 4xx, stop on
   429/5xx/network). At send time, re-read the player: skip (mark `failed` with
   the reason "unsubscribed since queueing") one who has meanwhile unsubscribed,
   unless `include_unsubscribed`; use the player's current username and a fresh
   unsubscribe link. When no pending recipient is left, mark the broadcast
   `done`. A stopped run releases its unsent claimed rows to `pending`.
   A recipient left in `sending` (a crash or timeout mid-send) is **never**
   resent automatically, because it may have been delivered; the admin page
   shows such rows so the owner can decide.
4. **Cron.** `wrangler.jsonc` gets `"triggers": { "crons": ["0 17 * * *"] }`.
   `packages/worker/src/index.ts` exports a `scheduled` handler that builds the
   same app context as `fetch` and calls `runQueuedBroadcast`. Errors are caught
   and logged with the message in the string. No other change to the worker.
5. **Routes (admin only).**
   - `POST /api/admin/email/broadcast/queue` with
     `{ subject, markdown, includeUnsubscribed, perRun, exclude }`; `perRun`
     integer 1 to 100, default 50; same validation style as the direct route.
     Answers the queue status.
   - `GET /api/admin/email/broadcast/queue` answers the active (or latest)
     broadcast's status: counts per recipient status, `perRun`, `lastRunAt`, the
     failed rows with reasons, and the number stuck in `sending`.
   - `POST /api/admin/email/broadcast/queue/run` runs one batch now (same
     function as the cron).
   - `POST /api/admin/email/broadcast/queue/cancel` sets `cancelled`; pending
     rows are never sent after that.
6. **Admin page.** A second panel under the composer, "Send over several days":
   reuse the composer's subject, body and unsubscribed checkbox and the skip box
   from slice 1; add "Per day" (default 50); a "Queue it" button with a
   confirmation that says how many recipients and how many days it will take. When
   a queue exists show: sent / pending / failed / stuck counts, last run time,
   "next run 17:00 UTC", the failed rows with reasons, and buttons "Send next
   batch now" and "Cancel". Poll the status only when the panel is opened or an
   action finishes, not on a timer.
7. **Tests** (server, repository, worker, web) as listed below.
8. **Docs.** `decisions.md` (append), README (the admin broadcast paragraph, the
   Tables list and the deploy notes: migration 0005 is applied before deploying,
   the cron needs a deploy), `state.md` line. Record: the cron time and why 50 a
   day; `sending` rows are never auto-resent; one active queue at a time; the
   snapshot of recipients at queue time with a send-time unsubscribe re-check.

**Out:**

- More than one active queue; editing a queued message; per-recipient retry
  buttons; a second schedule; time zones other than UTC.
- Resend Audiences/Broadcasts, bounce handling or webhooks.
- Changing the game mails or the direct broadcast route from slice 1.

## Paths

- `packages/worker/migrations/0005_broadcast_queue.sql`
- `packages/worker/src/index.ts`, `wrangler.jsonc`
- `packages/server/src/store/types.ts`, `store/d1.ts`, `store/json-file.ts`
- `packages/server/src/notifications.ts`, `packages/server/src/routes/admin.ts`
- `packages/server/test/` (repository, notifications, admin routes)
- `packages/web/src/lib/api.ts` (broadcast functions only), `packages/web/src/views/AdminView.tsx` and its test
- `docs/agents/decisions.md`, `state.md`, `README.md`

## Tests that must exist

- Repository (run for both implementations, and the D1 one through the existing
  `node:sqlite` harness): queue creation stores recipients; claiming N returns at
  most N, in a stable order, and two claims never return the same row; marking
  and releasing work; counts per status are right; a `done` or `cancelled`
  broadcast yields no claims.
- `queueBroadcast`: classifies like the direct broadcast (no address,
  unsubscribed, excluded, invalid), refuses a second active queue, snapshots the
  right recipients (555 accounts, 49 excluded gives 506 pending in a fixture).
- `runQueuedBroadcast`: sends 50 in **one** provider request, marks them `sent`,
  leaves the rest `pending`; a run with fewer than 50 left finishes and sets
  `done`; a 429 stops the run and releases the unsent rows to `pending`; a bad
  address ends as `failed` with the provider's message and the rest are `sent`; a
  recipient who unsubscribed after queueing is `failed` with the reason and no
  mail goes out; a row left in `sending` is not resent by the next run and is
  reported; a cancelled queue sends nothing; no active queue is a quiet no-op.
- Cron: the `scheduled` handler calls the run once and swallows a thrown error
  after logging it.
- Routes: non-admin gets 403, bad `perRun`/`exclude` gets 400, a second queue gets
  409, run and cancel behave as above.
- Web: queueing sends the right shape; the status shows the counts, the failed
  rows and the stuck count; the confirmation names recipients and days; run-now
  and cancel call the right endpoints.

## Done when

`pnpm -r typecheck && pnpm -r test && pnpm -r build` pass, the read-only
reviewer's last round has nothing above a nit, and the PR description tells the
owner the deploy order: apply migration 0005 to D1, then deploy the Worker.
