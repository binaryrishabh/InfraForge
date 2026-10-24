# Authentication and ownership

InfraForge uses Better Auth 1.7.7 with its Prisma adapter and PostgreSQL sessions.
Username/email/password is available without OAuth credentials. The native
username plugin is the only auth plugin; Google and GitHub remain optional.
Automatic account linking and cookie session caching stay disabled. An
unconfigured provider never appears as a working sign-in option.

The [1.7.7 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.7)
includes September 30 security fixes, including OAuth-state handling. Consult the
[official advisories](https://github.com/better-auth/better-auth/security/advisories)
before changing the pinned version. The installed Prisma adapter declares Prisma
7 support. The Express 5 auth handler owns its parsing, following the
[Express integration](https://better-auth.com/docs/integrations/express) and
[Prisma adapter](https://better-auth.com/docs/adapters/prisma) documentation.

## Local credentials

Start `bun run dev:setup`, then `bun run dev`, and open
`http://localhost:5173/signup`. Create a username, email and password. Sign-up
creates the ordinary Better Auth database session; `/signin` accepts one
**Username or email** field. Sign out through the account menu and use either
identifier to return to the same owned designs/runs. The isolated launcher
generates local session configuration and needs no provider credentials.

Usernames are 3–30 ASCII letters, digits or underscores, starting with a letter.
The server requires one on credential sign-up. Stored usernames are lowercase;
case variants identify the same account. Sign-in trims the identifier; sign-up
rejects surrounding whitespace. `User.name` supplies the display name and the
session exposes the normalized username. There is no second display-username
column. Usernames are immutable after assignment through the native plugin;
historical/OAuth users retain NULL unless they explicitly choose one. The
database enforces format and uniqueness, including concurrent registration.

New emails are trimmed/lowercased; the library validates them and the server
bounds them to 254 characters. No provider-specific dot/plus aliases are invented.
The existing unique email key remains, with an additional unique `lower(email)`
index protecting historical case collisions. With email disabled, credential sign-up leaves
`emailVerified=false`. Verification and account-management APIs default to disabled.
Configuring a mail provider alone does not enable them. With
`AUTH_EMAIL_ENABLED=true` (or `ACCOUNT_ESSENTIALS_ENABLED=true`), signup first proves
mailbox control, then accepts username/password and creates a verified user without
a session; the user then signs in. Registering an existing OAuth email does not add
a credential account or merge identities: use the original sign-in method.

Passwords use Better Auth's salted scrypt implementation and verification, with
explicit 15–128 library string-length bounds and no composition rules. The
[native credential flow](https://better-auth.com/docs/authentication/email-password)
and [username plugin](https://better-auth.com/docs/plugins/username) are supported
by pinned 1.7.7; InfraForge does not duplicate hashing or credential verification.
The one identifier field goes to a bounded server adapter. It selects the native
email handler when the identifier contains `@`, and the native username handler
otherwise. The original Better Auth Node handler still performs all verification,
rate limiting and cookie/session creation; the adapter performs no user lookup or
password verification. Both namespaces validate on the server.

Credential POST bodies accept bounded JSON/form data (8 KiB, including chunked
requests) before hashing. Pinned Better Call's Node adapter supports parsed bodies;
only credential routes use these parsers. OAuth callbacks retain the
raw-handler path. Origin and rate checks run first. Auth logs retain operational
errors and omit routine login/signup messages; passwords are never logged, returned or persisted
in browser storage. Forms use password-manager autocomplete and keep passwords
only in transient input state. Sign-in failures use a common message; rate limits
have a separate retry message. The username-availability endpoint is disabled.
With email disabled, native registration still returns a failure for duplicate
email/username; automatic sign-in cannot provide a sessionless synthetic duplicate
response. With email enabled, initial signup accepts an email address and sends
mailbox proof without consulting username or account membership. Requested
usernames/passwords are neither checked nor stored at this stage. After the user
opens that link, the UI submits email, proof and credentials. Username availability
is actionable only after valid mailbox proof and is rate limited (5/proof, 30/IP
per 15 minutes). A taken name leaves the proof usable for another attempt within
those limits. The availability endpoint stays disabled. Initial acceptance promises
durable work, not account creation or username reservation.

Migration 16 adds nullable `User.username`, its format/unique guards and the email
case-fold index. Migrations 1–15 are unchanged. Existing users/accounts/ownership
are preserved with no backfill. Historical case collisions abort the entire SQL
transaction and require explicit operator investigation, never account merging.
Release postchecks verify the credential identity indexes/constraint. Prisma 7
cannot express the functional email index in its schema: preserve this reviewed
[custom SQL migration](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/unsupported-database-features).
The controlled release refuses image rollback across differing migration
fingerprints. It does not drop usernames or credential accounts to downgrade;
use a reviewed forward fix or the established authorized backup/restore procedure.

Future methods, **not implemented**: email OTP/magic link and phone-number auth.
They must reuse the same user ID/ownership model, require real delivery and
verified linking decisions, and cannot adopt an existing account merely from an
unverified email/phone claim.

## Optional account essentials (backend APIs)

Set up real delivery and the owner checklist in [deployment](DEPLOYMENT.md) before
enabling `AUTH_EMAIL_ENABLED=true` for email, or `ACCOUNT_ESSENTIALS_ENABLED=true`
for email plus deletion/export. Invalid/partial configured providers
fail startup. A local outbox is available only with explicit development/test mode. The existing
UI is unchanged and does not yet expose these flows. Turning on verification or
Turnstile before implementing the UI needs below will interrupt existing signup UX.

| API | Request / behavior |
| --- | --- |
| `GET /api/auth/account-features` | `{enabled, emailEnabled, verificationRequired, turnstileSiteKey}`; site key is public; no secrets |
| `POST /api/auth/sign-up/email` (email enabled, initial) | `{email, callbackURL?, turnstileToken?}`; action `signup`; generic durable admission, no account/username lookup; callback defaults to first app origin `/signup` |
| `POST /api/auth/sign-up/email` (email enabled, completion) | `{email, emailProof, username, name, password}`; proof from emailed callback query; native credential validation and username errors after proof; verified account, no session |
| `POST /api/auth/sign-up/email` (email disabled) | Native credential fields plus configured `turnstileToken`; existing sessionful behavior |
| `POST /api/auth/send-verification-email` | `{email, callbackURL}`; uniform response regardless of existence/verification/session |
| `GET /api/auth/verify-email?token=...` | Native verification; expired, invalid or redeemed links fail |
| `POST /api/auth/request-password-reset` | `{email, redirectTo, turnstileToken?}`; action `password_reset`; uniform response |
| `POST /api/auth/reset-password` | `{token, newPassword}`; native password policy; revokes all sessions |
| `POST /api/account/delete` | Session plus `{password, confirmation:"DELETE"}`; current password required on every attempt |
| `GET /api/account/export?section=...&after=...` | Session; paginated JSON, opaque `next` cursor or null |

The feature-discovery endpoint stays available. Email flows return 404 while both
email and essentials flags are disabled; `/api/account/*` requires essentials. The
native hard-delete endpoints stay disabled even when enabled: foreign keys and
append-only records require the explicit semantics below. Account mutation uses
the same exact-Origin check as other APIs; no missing-Origin exemption is added.
Better Auth additionally validates redirect/callback origins and its own CSRF checks.
Body limits are 8 KiB on the new POST routes. Responses use `Cache-Control: no-store`
and `Referrer-Policy: no-referrer`. Do not add request/response tracing on these routes.

Reset and signup proof expire 30 minutes after admission. The worker derives a
transient bearer with HMAC-SHA256 over a domain-separated kind and random intent
ID using `BETTER_AUTH_SECRET`. Only SHA-256 digests of `reset-password:<bearer>`
and `signup-proof:<bearer>` enter `Verification`; reset bearers are never persisted
as plaintext or encrypted payloads. Better Auth 1.7.7's supported
`verification.storeIdentifier` hashing handles lookup/redemption. Native reset
atomically consumes the value, updates the password and revokes sessions. Signup
proof consumption and native user creation share the same database transaction.
The proof is bound to the normalized email and cannot authorize another address.

Verification resend uses the library's signed JWT and a hash-only single-use
`AccountEmailToken` ledger. A prepared verification JWT is encrypted in the mail
intent until delivery. Reissuing a same-second JWT does not revive a consumed
link. Failed redemption burns the link; request another email. Verification and
signup completion do not automatically sign in. OAuth-only users can establish a
password through native mailbox reset; duplicate signup cannot add credentials
or merge identities.

Initial signup, reset and resend normalize email, strip cookies, return the same
accepted body and apply a 750 ms minimum duration. A supported before hook commits
a generic `AccountMailIntent` before any membership-dependent work. All three
routes return the same service-unavailable response if admission fails, whether
the email exists or not. Input, challenge, origin and quota errors remain
actionable. Provider delivery is outside the request path; no native background
callback can swallow an admission error. The floor cannot guarantee equal latency
under infrastructure overload.

The API polls `AccountMailIntent` every five seconds, preparing at most 16 requests
and sending at most 16 messages sequentially per poll. Pending encrypted metadata
contains only email and callback, never username, password or reset bearer.
Preparation and token issuance share a transaction: rollback leaves pending work
for restart; a ready request is never reissued. Reset/resend membership lookup
happens here, while signup always prepares the same mailbox-proof step.
Claims use `SKIP LOCKED`, 30-second leases and explicit UTC timestamps, independent
of the PostgreSQL session timezone. Resend retries use identical messages and
idempotency keys, at most five attempts, within the 30-minute expiry; its
[idempotency window is 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys).
SES's [SendEmail API](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)
has no idempotency key: only explicit HTTP 429 rejection is retried. Timeouts,
lost acknowledgements or crashes during SES delivery become uncertain and are
never resent automatically; request a new link. This trades possible loss for
avoiding duplicates after ambiguous provider acceptance. Provider errors log only
a fixed message. Terminal outcomes erase payloads. Polling purges expired intents,
verification ledger and native verification records. Disabled/stopped polling
delays physical cleanup, never token expiry.

Keep `BETTER_AUTH_SECRET`, base URL and sender settings stable while requests are
pending; secret rotation invalidates pending proofs and decryption. Migration
`20261024130000_account_mail_intents` adds the new table; existing migrations are
unchanged. On every startup, before HTTP opens, legacy plaintext reset identifiers
and all legacy `AccountMailOutbox` payloads are retired, even if email is disabled.
Old reset links and pending legacy emails must be requested again. Existing
accounts and passwords are preserved. New account deletion removes user-linked
intents; pending generic requests have no user association and expire in 30 minutes.

Redis quotas use HMAC keys, never addresses/tokens in keys. All email-request
identities, including nonexistent ones, share the same accounting: 3 per normalized
email and 20 per IP per 15 minutes across reset/verification. Signup has separate
3/email and 20/IP quotas when email, essentials or Turnstile are enabled. Email-enabled
signup completion has a separate 5/proof and 30/IP quota; mailbox proof replaces
the challenge only on that completion path. Email-disabled signup always keeps
its configured challenge, regardless of a caller-supplied proof field. Redemption has
5/token and 30/IP quotas. Deletion has 10/user and 30/IP; export has 600/user and
600/IP. These fixed windows are shared across API processes; Redis failure closes
the routes. Better Auth's existing limits and the outer HTTP limiter also apply.
Trusted-proxy configuration replaces the internal IP header; callers cannot choose
the quota IP through that header.

Turnstile is independent of the essentials flag: configuring all three Turnstile
settings protects credential signup immediately. Reset is protected when its API
is enabled. An unconfigured challenge is skipped; a configured challenge rejects
missing/oversized tokens, provider errors/timeouts, replay rejection, wrong hostname
or wrong action. No positive validation cache is used. An explicit development/test
bypass is rejected in production. Cloudflare enforces
token expiry and single use through [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
OAuth callbacks retain their existing provider protections; Turnstile applies to
the credential signup endpoint, not OAuth redirects.

### Deletion and retained history

Deletion is a serializable transaction locking the user row. It returns 409 while
any Model-1 deployment is pending/running/live/runtime-active, an internal Model-2
run is queued/running, or a first-stack reservation is not terminal (including
recovery). Finish/cancel/resolve these runs through existing controls first.

The transaction deletes sessions, credentials/OAuth tokens, user-valued reset
verification records, verification redemption records and internal grants. It
replaces email with a random unreachable `@deleted.invalid` mailbox, clears name,
username, image and verification status, and marks `deletedAt`. Owned design names,
layouts and legacy `userId` fields are scrubbed; opaque design IDs/owners remain.
Database guards prevent restoring the profile or adding sessions, accounts or new
owned data after deletion, and serialize those admissions against deletion.
Existing WS connections close on their next authoritative session check.

Run IDs, owner IDs, captured run names, immutable inputs, lineage, actions, samples,
cuts and results remain unchanged. This is profile erasure and pseudonymisation,
**not complete erasure of arbitrary personal text submitted inside historical run
payloads**. Backups retain their own retention policy. Historical rows cannot be
adopted by a new registration with the freed email/username. The retained user row
is a disabled foreign-key anchor, not a login-capable account. Migration 21 only
adds columns, a table, constraints and guards; existing immutable triggers remain
unchanged. Export data before deletion; subsequent access is revoked.

### Export and UI follow-up

Sections are `designs`, `runs`, `actions`, `samples`, `internalRuns`, `lessons`,
`firstStackRuns`, `cuts`, `results`. Each JSON page has schema
`infraforge-account-export/1`, `section`, `records` (at most one), and `next`.
Follow `next` within each section until null (an empty final page); concatenate records into arrays in
the downloadable archive. All queries independently filter the current user's
ownership, including child results/cuts/samples. Cursors never grant access.
Model-1 terminal results are in `runs`; internal evidence in `internalRuns`;
first-stack results in `results`. Auth tables, reset tokens, worker fencing tokens,
delivery state and other users' records are excluded. Pages are live reads rather
than a point-in-time snapshot; export after stopping runs for a stable archive.

Typed client functions live in `apps/web/src/features/auth/accountClient.ts`,
including an async page iterator, `requestSignupProof` and `completeEmailSignup`.
UI work still needed: email-only signup, pending-proof state, callback parsing of
`emailProof`, then username/password selection with actionable taken-name errors;
resend/verification completion; forgot/reset password pages and safe token handling; Turnstile widgets with matching actions; download progress/cancellation;
deletion dialog with current-password input, `DELETE`, active-run conflict guidance,
and the retained-history explanation. OAuth users need mailbox password recovery
guidance. After successful deletion, clear per-user local drafts and auth/app state.
Keep passwords/tokens transient; scrub reset tokens and signup proof from browser
history before analytics/scripts, and exclude auth callbacks and export contents from analytics/error capture.
`turnstileToken.ts` exposes `setTurnstileTokenProvider` and
`obtainTurnstileToken("signup" | "password_reset")`. Register a bridge to the
owner-selected widget; call it immediately before submission and pass the fresh
token as `turnstileToken`. It loads no scripts, renders no UI and caches no tokens.

### Email and Turnstile configuration

All settings below are backend environment variables. Nothing is enabled by
default. `AUTH_EMAIL_VERIFICATION_REQUIRED=false` makes verification optional for
sign-in for existing accounts; email-enabled signup always proves mailbox control and returns no session.
`ACCOUNT_ESSENTIALS_ENABLED=true` also enables email for backward compatibility.
Production configuration is validated before the server starts listening.

| Variable | Default / exact meaning |
| --- | --- |
| `AUTH_EMAIL_ENABLED` | `false`; verification + reset without enabling deletion/export |
| `AUTH_EMAIL_VERIFICATION_REQUIRED` | `true`; require verified email for credential sign-in when email is enabled |
| `ACCOUNT_ESSENTIALS_ENABLED` | `false`; enables email plus account deletion/export |
| `TRANSACTIONAL_EMAIL_PROVIDER` | Unset; `ses`, `resend`, or `local` (local only with `NODE_ENV=development` or `test`) |
| `TRANSACTIONAL_EMAIL_FROM` | Required plain sending mailbox for SES/Resend, for example `accounts@auth.example.com` |
| `RESEND_API_KEY` | Required only for Resend; sending-only key scoped to the verified domain |
| `SES_REGION` | Required for SES, e.g. `us-east-1`; commercial regions only |
| `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | SES IAM API credentials, not SMTP credentials |
| `SES_SESSION_TOKEN` | Optional session credential token; renew before it expires |
| `TURNSTILE_ENABLED` | Unset: activates when any Turnstile key/hostname is supplied; `true` requires complete config, `false` explicitly disables |
| `TURNSTILE_SITE_KEY` | Public widget key; exposed by feature discovery |
| `TURNSTILE_SECRET_KEY` | Backend-only Siteverify secret |
| `TURNSTILE_HOSTNAMES` | Comma-separated exact frontend hostnames, no schemes, paths or wildcards |
| `TURNSTILE_PROTECT_RESET` | `true`; set `false` to challenge signup only |
| `TURNSTILE_DEV_BYPASS` | `false`; explicit bypass allowed only in development/test, rejected in production |

Use `TRANSACTIONAL_EMAIL_PROVIDER=local` and `AUTH_EMAIL_ENABLED=true` with
`NODE_ENV=development` for local mail. It writes exclusive JSON files under the
worktree's ignored `.cache/mail-outbox/`, never console output. Signup-proof and
verification files contain plaintext development links; delete them after testing.
Reset messages write only a redacted receipt, never the bearer. Use the in-memory
email fake for local reset redemption tests or staging delivery for a manual reset.
No local adapter can run in production. Production adapters have fixed HTTPS endpoints, bounded timeouts,
no redirects and sanitized errors. No provider secrets are returned or logged.

1. **SES:** in the selected region, create a verified domain identity and enable
   [Easy DKIM](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy.html).
   Publish the identity's exact three generated CNAME records, typically
   `<selector>._domainkey.auth.example.com` → `<selector>.dkim.amazonses.com`;
   selectors/targets must come from that account's console. Request production
   access outside the sandbox. Create IAM API credentials with `ses:SendEmail`
   restricted to that identity and sending address. Set the SES variables above;
   arrange rotation and bounce/complaint monitoring. [OWNER: confirm domain,
   region, IAM policy and delivery operations].
2. **SES SPF:** configure a custom MAIL FROM subdomain, for example
   `bounce.auth.example.com`. Publish MX priority `10` to
   `feedback-smtp.<SES_REGION>.amazonses.com` and a single TXT SPF record
   `v=spf1 include:amazonses.com ~all` at that MAIL FROM name. Choose rejection
   rather than fallback if custom MAIL FROM DNS fails. These are envelope-domain
   records; they do not replace DKIM at the visible From domain. Follow
   [SES MAIL FROM setup](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html).
3. **Resend alternative:** add and [verify the sending domain](https://resend.com/docs/dashboard/domains/introduction).
   Publish the exact generated DKIM TXT at its selector and the displayed sending
   subdomain's SPF TXT and feedback MX. Copy account/region-specific values from
   the dashboard; do not invent a public key or assume another region's MX target.
   Create a [sending-access API key](https://resend.com/docs/dashboard/api-keys/introduction)
   limited to that domain, store it as `RESEND_API_KEY`, and select `resend`.
   Disable open and click tracking/link rewriting in domain settings.
   [OWNER: confirm provider, domain, region, tracking settings and processor terms].
4. **DMARC for either provider:** publish one TXT at
   `_dmarc.auth.example.com`, initially `v=DMARC1; p=none` while verifying alignment.
   After inspecting deliveries and authorizing every sender, move to `p=quarantine`
   then `p=reject` as appropriate. [OWNER: confirm enforcement policy and any
   aggregate-report mailbox; reports disclose message metadata]. Keep one SPF
   record per name, merge authorized senders if needed, and never replace existing
   business-mail DNS blindly. Verify SPF, DKIM and DMARC in actual received headers.
5. **Turnstile:** create a widget in the
   [Cloudflare dashboard](https://developers.cloudflare.com/turnstile/get-started/),
   restrict it to the frontend hostnames, and copy its public site key and secret
   to the matching variables. Set `TURNSTILE_ENABLED=true`. The UI must issue
   actions `signup` / `password_reset`; backend checks hostname and action on
   every request through Siteverify. Tokens expire after five minutes and are
   single use. [OWNER: confirm widget mode, domains and privacy disclosure].

Add these settings through the release operator's environment; Compose forwards
them to the API. The example environment file is not an activation record. Complete
the owner-selected UI before turning on email or Turnstile. Test real delivery,
expired/replayed links, failed challenges and generic signup/reset responses in
staging. No owner provider credentials or DNS changes were exercised by unit tests.

## Configuration

The supervised local launcher uses the ignored root `.env.development.local` and
ignores app dotenv files. For separately started entrypoints, set these through the
environment or the gitignored `apps/backend/.env`:

| Variable | Meaning |
| --- | --- |
| `BETTER_AUTH_SECRET` | Stable random secret of at least 32 characters, shared by API and WebSocket processes; no default |
| `BETTER_AUTH_URL` | Exact public API origin, such as `http://localhost:3000` locally; no path or trailing slash |
| `APP_ORIGINS` | Comma-separated exact frontend origins, such as `http://localhost:5173`; no wildcard or path |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Both required to enable Google |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Both required to enable GitHub |
| `DATABASE_URL` | PostgreSQL connection for API and WebSocket server; local worker also uses this |
| `WORKER_DATABASE_URL`, `WORKER_DATABASE_MODE` | Production Compose worker connection; provider-verified `direct` or `session` mode |
| `MIGRATION_DATABASE_URL` | Direct PostgreSQL connection for the controlled release migration |

Generate and store a real random secret securely; do not copy a documentation
example as a secret. Never put provider secrets into a frontend environment file.
Frontend public settings remain `VITE_BACKEND_API_URL` (including `/api`) and
`VITE_WS_URL`. API and WebSocket processes must use the same auth secret/origin
settings. In production, set `NODE_ENV=production`; configured origins must use
HTTPS. HTTPS enables Secure cookies. Cookies are host-only, HttpOnly, SameSite=Lax
and scoped to `/`. Configure frontend, API and WebSocket endpoints on the same
site; unrelated sites cannot share this cookie policy. API and WebSocket endpoints
must also use the same hostname because the session cookie is host-only. Route
WebSockets through that API host (for example, `/ws`). Use WSS through the trusted
reverse proxy in production. Proxy routing, TLS and trusted-proxy/rate-limit
settings follow [the controlled release process](DEPLOYMENT.md) and its host Nginx template.
Compose keeps Redis on its private service network with no host-published port.
Do not expose Redis or its control/event channels to public clients.

Register exact provider redirect URLs:

- Google: `<BETTER_AUTH_URL>/api/auth/callback/google`
- GitHub: `<BETTER_AUTH_URL>/api/auth/callback/github`

Provider consent configuration and externally registered credentials belong to the
owner. No OAuth login is verified merely by installing the library or creating a
session fixture. Without OAuth credentials, password sign-in remains available.
With account linking disabled, using another provider for an existing email may
require the original provider; InfraForge does not silently merge identities.

Owner configuration steps:

1. Choose the public frontend and API domains on the same site. Set `BETTER_AUTH_URL`
   to the exact HTTPS API origin and `APP_ORIGINS` to each permitted exact frontend
   origin. Use that same API hostname for WSS `/ws`; register DNS and trusted TLS.
2. In Google's project, configure app branding/consent/audience and permitted test
   users as needed, then create a **Web application** OAuth client. Register exactly
   `<BETTER_AUTH_URL>/api/auth/callback/google`. Store its ID/secret only on the backend.
   See [Google's server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server)
   and [Better Auth Google setup](https://better-auth.com/docs/authentication/google).
3. In GitHub Settings → Developer settings → OAuth Apps, create an OAuth App with
   the public frontend homepage and exactly
   `<BETTER_AUTH_URL>/api/auth/callback/github` as its authorization callback.
   Store its client ID/secret only on the backend. Use a separate app for local or
   staging callbacks. See [GitHub's instructions](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).
4. Set both credentials in each enabled provider pair and keep the stable random
   Better Auth secret shared by API/WS. Configure Vercel public endpoint variables
   and `apps/web` root as described in [deployment](DEPLOYMENT.md). Verify real
   provider sign-in, session loading/sign-out/expiry and authenticated WS before
   production frontend promotion. Fixture sessions do not verify OAuth callbacks.

## Access rules

Protected HTTP routes read identity from the current database session. Every
design query and mutation filters by its verified owner; run/report/control/WS
access uses the run's independently retained `ownerId`. Deleting an inactive design
does not remove or transfer its historical runs. Client `userId`
and `ownerId` values never grant access. Missing sessions return 401; another user's
or quarantined records return 404. Lists contain only the current user's records.
Unsafe HTTP requests require an exact permitted Origin in addition to Better
Auth's built-in CSRF/OAuth-state checks. Unknown origins are rejected even for
reads. The old bulk-delete and manual deployment-probe routes are removed.

WebSocket upgrades require a valid database session and an exact permitted Origin.
Ownership is checked before opening a Redis subscription and again before each
event is delivered. Connections check session validity every second and close with
1008 when it ends; database failures fail closed. Session revocation/sign-out stops
delivery without trusting a cached cookie. Sessions have fixed seven-day expiry
and are not silently renewed. Resource/rate budgets remain process-local and need
hosted load testing.

The browser loads its user from the server, sends credentials with API requests,
handles session expiry, and confirms server sign-out before reporting success.
An account change clears canvas/monitoring/modal state, cancels pending requests,
and remounts protected pages. Draft keys use the server user ID. Old password
registry/session and unscoped draft keys are removed; old drafts have no verified
owner and are not automatically adopted. Named per-user drafts remain local after
sign-out, so anyone with access to that browser profile can inspect its storage.

## Additive migration and legacy recovery

Run the versioned migration before starting the new API/worker/WebSocket processes.
The manual release workflow applies and verifies versioned migrations while the
application is stopped. Promotion still requires owner configuration, a backup
plan and successful release/OAuth verification; see [deployment](DEPLOYMENT.md).
It adds the four auth tables and a nullable `Infrastructure.ownerId` foreign key.
Existing historical `userId`, layouts, runs, inputs and checkpoints are preserved.
Existing designs receive no guessed owner and are quarantined. Workers refuse
ownerless jobs and retire interrupted/ownerless active runs with a clear reason;
they do not reconstruct or resume a legacy simulation.

Recover only a specific design after establishing independent ownership evidence.
The historical `test-user` marker alone proves nothing. The target must already
exist with verified email, the design must still be unassigned, its historical
marker must match, and it must have no active runs. The database also rejects
reassignment of an owned design. Dry runs include the count of linked unassigned
historical runs; applying recovery assigns those inactive runs in the same transaction.
Detached ownerless history cannot be claimed through this design recovery method.
Recovery preserves historical fields and original
run inputs. This is an operator CLI, never a public endpoint or automatic startup
operation.

From `apps/backend/`, against an explicitly approved database, first run:

```powershell
bun run scripts/recover-ownership.ts --design <design-uuid> --user <verified-user-id> --legacy-user <historical-marker> --evidence <ownership-evidence-reference>
```

Inspect the dry-run result and preserve it with the ownership evidence. Only then
repeat the identical command with `--apply`, and preserve its result. No bulk
recovery is provided. Production recovery requires explicit production authorization;
development task authorization does not grant it.

## Tests

`bun run test:integration:local` uses fresh owned PostgreSQL/Redis fixtures. Users
and signed sessions are created through Better Auth's public credential endpoints
for credential/HTTP/WS isolation, and its actual database adapter for explicit legacy fixtures;
the HTTP and WebSocket services enforce their normal checks. There is no test login
endpoint, fake provider or disabled protection. Tests cover two users, forbidden
reads/writes/controls/subscriptions, rejected origins, expiry, revocation, actual
sign-out, legacy quarantine, worker refusal and dry-run-first recovery. Rejected
commands must leave domain rows/outbox unchanged and publish no simulator controls.
The existing lifecycle and all 30 engine goldens continue to verify B0.2 behavior.
