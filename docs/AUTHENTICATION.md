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
index protecting historical case collisions. Credential sign-up leaves
`emailVerified=false`. Email verification is not required for this local milestone,
and no delivery service, reset button, fake verification or automatic linking is
added. Registering an existing OAuth email does not add a credential account or
merge identities: use the original sign-in method.

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
Native registration still returns a failure for duplicate email/username, as
permitted for this milestone; automatic sign-in cannot provide the library's
sessionless synthetic duplicate response. Do not claim zero registration enumeration.

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
unverified email/phone claim. Password reset also waits for real email delivery.

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
