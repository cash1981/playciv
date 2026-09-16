# Admin and user management

## Goal

Introduce persistent account roles and access status. Every newly registered
account is an enabled `user`; `admin` is the only elevated role, and a separate
`disabled` flag represents the no-access/banned state. Add server-enforced
admin user management and a protected admin page linked from the front-page
navigation. Keep authorization derived from the current database account so a
future OpenID/OAuth provider can replace password login without changing role
semantics or requiring roles in bearer tokens.

## Acceptance criteria

- Legacy player records default safely to `role: user` and `disabled: false`.
- The `cash` account can be promoted to admin by an idempotent Mongo migration
  command; it must not require or expose a password.
- Disabled accounts cannot log in or use authenticated endpoints.
- Only admins can list, edit, disable/enable, promote/demote, or delete users;
  admin authorization is enforced by the server, not only the UI.
- The API never returns password hashes.
- The web app exposes an Admin link/page only for admins, with normal user
  administration controls and safe handling of the current admin account.
- Existing game authorization that used the literal `admin` username is
  updated to use the persisted admin role where appropriate.
- Add focused server/client tests and preserve all existing behavior.
- Update state/decisions/task-board when complete.

## Likely paths

`packages/server/src/store/types.ts`, `packages/server/src/store/json-file.ts`,
`packages/server/src/store/mongo.ts`, `packages/server/src/routes/auth.ts`,
`packages/server/src/routes/games.ts`, `packages/server/src/routes/admin.ts`,
`packages/server/src/auth.ts`, server app wiring, migration script/package
commands, server tests, `packages/web/src/App.tsx`, `packages/web/src/lib/api.ts`,
`packages/web/src/views/AdminView.tsx`, related web tests/styles, and the agent
state/decision/task-board documentation.

## Out of scope

Implementing an external OpenID/OAuth provider, account linking, password
reset, or deleting games owned by a deleted user.
