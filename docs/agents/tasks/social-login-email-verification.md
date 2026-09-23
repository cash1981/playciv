# Social login and email verification

- **Slug:** `social-login-email-verification`
- **Branch:** `feat/social-login-email-verification`
- **Owner:** orchestrator (DeepSeek V4.1 Flash) with the `coder` subagent
- **Status:** ready to implement; every design question below was answered by the human on 2026-09-23

## Goal

Two things that belong together. First, an account made with a username and a
password must prove control of its email address before it can take part:
after registering it can sign in and look around, but every write is refused
until the link from the mail is opened. Second, people can create or sign into
an account with Google, Facebook or Discord instead of a password; an account
made that way is verified when the provider says the address is verified. The
old security question ("What is China's starting tech?" → `writing`) stays for
everyone and is asked together with the username in the completion step after
the first provider login. Apple is deliberately not shipped: it needs a paid
Apple Developer Program membership, which the human refused, so only the free
providers are in. The provider table is written so Apple can be added later if
that changes.

## Why

Issues #42 and #121. The human's constraints, quoted:

- "Jeg ønsker email verifikasjon for de som ikke bruker sosial login."
- "typ openid connect med oauth2.0", initially "google, facebook, apple";
  then, when the price came up: "jeg skal ikke ha noe social innlogging hvis
  det koster penger. Er det noen som er helt gratis så velg de". Google,
  Facebook and Discord are free to set up; Apple costs 99 USD/year and is out.
- The security question must survive: "Jeg er usikker hvordan vi skal håndheve
  'writing' idag ... Kanskje vi fortsatt kan ha det med hvis det går".

Decisions the human made in the same round:

| Question | Answer |
| --- | --- |
| Unverified accounts | Can sign in and read; cannot take part — no game actions, no chat, no writes of any kind |
| The ~554 migrated accounts | Marked verified; verification applies to new accounts only |
| Provider login with an email that matches an existing account | Auto-link when the provider reports the email verified and exactly one account matches; two or more matches → refuse and ask for admin help |
| Email uniqueness | Unique for new accounts; legacy duplicates are left alone |
| Admin page | Shows verification status, can mark an account verified manually, and can re-send the link |
| Local dev without `RESEND_API_KEY` | Auto-verify and print the link in the server console |
| Provider keys | The human has none yet; ship a setup checklist per provider and show a button only for configured providers |

## Reference

This is a new feature. Neither `old-civ-rest` nor `old-civ-web` has social
login or account email verification, so there is nothing to port and no game
rule is involved — the `rules-checker` is not needed. The old pieces that are
reused:

- The security question: `old-civ-web/app/scripts/controllers/RegisterController.js`
  compared the raw value with `toUpperCase()` against `WRITING`; already ported
  server-side as `isSecurityAnswer` in `packages/server/src/auth.ts` (issue #40).
- The reset-link shape: `ResetTokenSigner` and the server-HTML confirmation page
  in `packages/server/src/routes/auth.ts` (issue #37). The verification link
  follows the same pattern.
- The mail conventions: `notifications.passwordReset` — transactional, no
  unsubscribe footer, best-effort (a send failure is logged, never fails the
  request).

## Scope

**In:**

- `emailVerified` on the player, unique email for new registrations, a signed
  verification link with a 24 h TTL, a resend endpoint, and a client banner
  while unverified.
- Social sign-in and registration through Google, Facebook and Discord
  (OAuth 2.0 authorization code + PKCE S256; Google's identity read from the
  OIDC userinfo endpoint).
- Account linking by provider-verified unique email, and provider identities
  stored on the player.
- A completion step for new social accounts: username + security question.
  The account row is created only then — the provider flow carries a signed
  pending token instead of a placeholder account.
- Admin: verified column, manual verify, send the verification mail.
- Provider configuration through environment variables / Worker bindings;
  buttons only for configured providers; a setup checklist in `README.md`.

**Out:**

- Apple, Microsoft and GitHub. Apple is paid; the other two were not asked for.
  The provider table makes adding them a small, separate change.
- An account settings page (link/unlink a provider, change your own email, set
  a password on a social account). Password reset can already give a social
  account a password; linking a provider from inside the app is a separate
  issue.
- Two-factor auth, session revocation and refresh tokens: unchanged.
- Re-verifying the migrated accounts: the human chose to grandfather them.
- Rate limiting on registration, resend or the OAuth endpoints. None of the
  existing auth routes have any, so adding it here would be a new policy the
  human did not ask for.

## Approach

### Data model

- `StoredPlayer.emailVerified?: boolean` — optional at the boundary (legacy
  records have no field). Missing means **verified**, because the migrated
  accounts are grandfathered. New records always carry the field explicitly, so
  a forgotten `false` is a review finding, not a silent bypass.
- `StoredPlayer.oauthProviders?: readonly OAuthIdentity[]` with
  `OAuthIdentity = { provider: 'google' | 'facebook' | 'discord'; providerUserId: string }`.
  Lookup scans `allPlayers()` — the same approach the password-reset route
  already uses for email. At 554 accounts that is fine, and it needs no new
  `Repository` method and no new table. D1 stores it as JSON text.
- No password on a social account: keep `passwordHash: string` and write `''`.
  `verifyPassword` already returns false when the stored value has no `:`;
  pin that with a test. `''` is never a usable password.
- D1 migration `packages/worker/migrations/0004_email_verified_oauth.sql`:

  ```sql
  ALTER TABLE player ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE player ADD COLUMN oauth_providers  TEXT NOT NULL DEFAULT '[]';
  -- Everything that exists before this migration is grandfathered.
  UPDATE player SET email_verified = 1;
  ```

  Migrations run before the deploy, so the `UPDATE` cannot mark a new account
  verified. The D1 test suite applies the file to an empty database, where the
  `UPDATE` is a no-op.
  - `PlayerRow`, `PLAYER_SELECT`, `createPlayer`, `updatePlayer` and
    `toStoredPlayer` in `packages/server/src/store/d1.ts` gain the two columns.
  - The `migrate:d1` import path (`packages/server/src/migrate/rows.ts`) must
    write `email_verified = 1` explicitly, because re-running the import is a
    fresh insert and would otherwise default to 0.
  - `JsonFileRepository.load` normalizes a missing `emailVerified` on an
    existing file to `true` and missing `oauthProviders` to `[]`;
    `createPlayer` normalizes `oauthProviders` and writes `emailVerified`
    exactly as given (the routes always set it).
- `PlayerUpdate` gains `emailVerified?: boolean` and
  `oauthProviders?: readonly OAuthIdentity[]`.
- `PlayerDto` gains `emailVerified: boolean`; `AdminUserDto` inherits it.
- Admin email change: when the address actually changes, set
  `emailVerified: false` — the new address is unproven. The admin can verify
  manually or send the link afterwards.

### Email verification (server)

- `Mailer` gains `readonly enabled: boolean`: `noopMailer` is `false`, the
  Resend mailer is `true`, test fakes set it. `Notifications` exposes
  `readonly emailDeliveryEnabled: boolean` so a route can tell whether mail
  really goes out.
- `Notifications.emailVerification(email, link)` — transactional, subject
  "Please verify your email address", no unsubscribe footer.
- `EmailVerifyTokenSigner` in `packages/server/src/auth.ts`, modelled on
  `ResetTokenSigner`, with its own derived key label (`email-verification`) and
  a 24 h TTL. Payload `{ playerId, expiresAt }`. A verification token must be
  rejected as a session token and as a reset token, and vice versa; tests pin
  that.
- One helper builds and sends the link (used by register, resend and the admin
  action) so the token/mail logic exists once.
- `POST /api/auth/register`:
  - email becomes required and is shape-checked with the existing
    `EMAIL_SHAPE`; a second account with the same address (case-insensitive,
    trimmed) is `409 EMAIL_TAKEN`.
  - the account is created with `emailVerified: false` and a verification mail
    is sent (best-effort, like every other mail).
  - when `emailDeliveryEnabled` is false (local dev, tests with the default
    noop mailer), the account is created `emailVerified: true` and the link is
    written to the server console with `console.warn` — the human's dev choice.
    This is also the production behaviour if `RESEND_API_KEY` is ever missing;
    the warning must say so.
  - the response stays `{ token, player }`; the client reads `emailVerified`.
- `GET /api/auth/verify-email/:token` → sets `emailVerified: true` and answers
  server HTML in the style of the reset page; an invalid or expired token gets
  the 404 HTML page. No client route is needed for the link itself.
- `POST /api/auth/verify-email/resend` (authenticated): optionally takes a new
  `email` (validated, unique) and stores it unverified, then sends a fresh
  link. Answers `{ ok: true }` even when a mail send fails, like every other
  mail path.
- `GET /api/auth/verify/:token` (password reset) also sets
  `emailVerified: true`: being able to open the mail proves control of the
  address.
- The write gate: in `authenticateWith`, an account with
  `emailVerified === false` may only make `GET` requests; everything else is
  `403 EMAIL_NOT_VERIFIED`. The resend route is the single exemption (it is a
  POST by an unverified account by design). `requireAdminWith` inherits the
  gate through `authenticateWith`. `authenticateOptionallyWith` is used only by
  GET routes today; check that when the gate lands, and gate it too if a write
  route ever appears there.

### Social login (server)

- New `packages/server/src/oauth.ts` with a static provider table. Endpoints
  (pin one Graph API version for Facebook in a single constant):

  | Provider | Authorize | Token | Userinfo | Scopes |
  | --- | --- | --- | --- | --- |
  | Google | `https://accounts.google.com/o/oauth2/v2/auth` | `https://oauth2.googleapis.com/token` | `https://openidconnect.googleapis.com/v1/userinfo` | `openid email profile` |
  | Facebook | `https://www.facebook.com/v21.0/dialog/oauth` | `https://graph.facebook.com/v21.0/oauth/access_token` | `https://graph.facebook.com/v21.0/me?fields=id,name,email` | `email public_profile` |
  | Discord | `https://discord.com/oauth2/authorize` | `https://discord.com/api/oauth2/token` | `https://discord.com/api/users/@me` | `identify email` |

  - Google's userinfo returns `sub`, `email`, `email_verified`. Discord returns
    `id`, `email`, `verified`. Facebook returns `id`, `email`; a returned
    address is treated as verified (Facebook only exposes a confirmed primary
    address).
  - PKCE S256 on every provider. `state` is a signed token with its own derived
    key label (`oauth-state`, 10 min TTL) carrying
    `{ provider, codeVerifier, expiresAt }` — self-contained, no cookie, the
    same idea as the reset link.
  - Identity comes from the userinfo endpoint called over TLS with the token
    from the code exchange. No `id_token` parsing or JWKS validation: Google's
    userinfo is the standard OIDC endpoint, and a locally validated id_token
    would add a JWT verifier for no security gain here. Record this in
    `decisions.md`.
- Config: `CreateAppOptions.providers?: Partial<Record<ProviderId, { clientId: string; clientSecret: string }>>`.
  Node reads `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`,
  `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET`,
  `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`; the Worker `Env` mirrors them.
  Redirect URI: `${appOrigin}/api/auth/oauth/{provider}/callback`.
- Routes:
  - `GET /api/auth/providers` (public) → `[{ id, displayName }]` for configured
    providers only.
  - `GET /api/auth/oauth/:provider` → `404` JSON for an unconfigured or
    unknown provider; otherwise a 302 to the provider with `client_id`,
    `redirect_uri`, `response_type=code`, `scope`, `state`, `code_challenge`,
    `code_challenge_method=S256`.
  - `GET /api/auth/oauth/:provider/callback?code&state` → verify the state
    (signature, expiry, provider match), exchange the code with the verifier,
    fetch userinfo. Then:
    1. the identity is on a player → sign that player in;
    2. no identity, a provider-verified email matches exactly one account →
       append the identity, sign that account in;
    3. no identity, a provider-verified email matches two or more accounts →
       redirect with `error=oauth_duplicate_email`;
    4. anything else (no address, or an address the provider calls
       unverified) → a signed pending-registration token (15 min TTL) and the
       completion step.
    Redirects back into the SPA: `#token=<session>`, `#pending=<token>` or
    `#error=<code>` on `${appOrigin}/auth/callback`. A refused or failed
    provider exchange is `error=oauth_denied` / `oauth_failed`; a bad state is
    `error=oauth_state`.
  - `POST /api/auth/complete-registration` → `{ pending, username, securityAnswer }`.
    Verify the pending token; require `isSecurityAnswer` (wrong answer →
    `400 WRONG_SECURITY_ANSWER`, as register does); require a free username
    (`409 USERNAME_TAKEN`) and re-check the email is still unique
    (`409 EMAIL_TAKEN`). Create the player with `passwordHash: ''`,
    `emailVerified` equal to what the provider reported, the one identity,
    `role: 'user'`, `disabled: false`. Send a verification mail when the
    provider said the address was unverified. Answer `{ token, player }` like
    login.
- A password login attempt on a social-only account simply fails (no stored
  password). "Forgot password" can install one; that is deliberate and is
  written down.

### Client

- `packages/web/src/lib/api.ts`: `PlayerDto.emailVerified`; new calls
  `providers()`, `verifyEmailResend(email?)`, `completeRegistration(pending, username, securityAnswer)`.
- `LoginView`: below the form, "or sign in with" buttons from
  `api.providers()`; a click navigates the whole page to
  `/api/auth/oauth/{id}` (the Vite dev proxy already forwards `/api`). The
  section is absent when the list is empty or the call fails. Registration mode
  keeps the security question and the email field.
- `App`: a new `auth-callback` screen for `/auth/callback`. On mount it reads
  the hash once:
  - `token` → `storeToken`, `api.me()`, set the player, and clean the URL with
    `history.replaceState('/')` — a session token must never stay in the
    address bar or the history.
  - `pending` → the completion form (username + the security question),
    submitted to `completeRegistration`; on success store the token and go to
    the lobby. A refresh before completing may start over; that is acceptable
    for a one-step form.
  - `error` → the login screen with a readable message
    (`oauth_duplicate_email` → "Several accounts use this email address.
    Please contact the admin.").
- Verify banner: while `player !== null && player.emailVerified === false`,
  every signed-in screen shows a notice with the current address and a "Send
  new verification email" button (`verifyEmailResend`); when the account has no
  address (a provider that returned none), the notice asks for one. After the
  button, say the mail was sent. `GET /api/auth/me` on the next load reflects
  the verified state.
- `AdminView`: a Verified column, a "Verify" button on unverified rows
  (`PATCH /api/admin/users/:id` with `{ emailVerified: true }`) and a "Send
  verification" button (`POST /api/admin/users/:id/send-verification`). The
  button reports success or failure in the row.

## Claimed paths

- `packages/server/src/**`
- `packages/server/test/**`
- `packages/worker/migrations/**`
- `packages/worker/src/index.ts`
- `packages/web/src/**`
- `packages/server/.env.example`
- `README.md`
- `docs/agents/tasks/social-login-email-verification.md`
- `docs/agents/decisions.md` (append only)

Shared resources: `packages/web/src/lib/api.ts` is claimed on the task board.

## Acceptance criteria

- [ ] Registering with a password requires an email; a second account with the
      same address is rejected `409 EMAIL_TAKEN`; the account starts
      unverified and, with a live mailer, a verification mail with a link goes
      out; opening the link marks the account verified; an invalid or expired
      token answers the HTML 404 page.
- [ ] An unverified account can sign in and read; every write answers
      `403 EMAIL_NOT_VERIFIED`; the resend route is allowed; after verification
      the same write succeeds.
- [ ] With no live mailer, registration marks the account verified and prints
      the link to the console (a test pins both behaviours).
- [ ] `GET /api/auth/providers` lists only configured providers; the start
      route redirects with PKCE S256 and a signed state; a forged or
      provider-mismatched state is refused; with a stubbed provider fetch the
      callback signs in a known identity, links a unique verified email to an
      existing account, refuses a duplicate email with
      `oauth_duplicate_email`, and sends a new identity to the completion step;
      completion rejects a wrong `writing` answer and a taken username and then
      creates a verified account with no password.
- [ ] A verification token is rejected as a session token and as a reset
      token, and a session token is rejected as a verification token.
- [ ] Legacy players (no `emailVerified` in the JSON file; rows seen by
      migration 0004) are verified; the password-reset link marks an address
      verified; an admin email change clears it.
- [ ] The admin list carries `emailVerified`; manual verify and send-verification
      work; a non-admin call to either is still `403`.
- [ ] Client: provider buttons appear only when configured; the callback stores
      the session and clears the hash; the completion step works; the
      unverified banner shows and its button calls the resend endpoint.
- [ ] Existing tests keep passing without weakening: notification and broadcast
      tests use a live fake mailer, so their local `register` helpers verify the
      account (or clear the recorded verification mail before counting mails).
      No assertion is deleted or loosened.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass, with the
      real counts reported.
- [ ] Hidden information: provider identities and verification status appear
      only on one's own `/me` and the admin list; no projection of another
      player's data changes; the existing leak tests stay green and the admin
      `403` is pinned.
- [ ] Browser-verified against a local server: the banner and resend flow, and
      the social section's behaviour without keys (absent). With no provider
      keys available locally the OAuth round trip cannot be exercised in a real
      browser; that path is covered by the stubbed-fetch server tests and the
      browser report says exactly what was seen.
- [ ] `README.md` documents the six environment variables, the callback URL per
      provider, and the setup steps (Google Cloud OAuth client; Facebook app
      with the `email` permission; Discord application), including that Apple
      was left out because it is paid.

## Open questions

None. Every question was answered by the human on 2026-09-23 (see the table in
"Why"). New questions must come back to the orchestrator rather than being
guessed in code.
