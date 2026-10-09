# Authentication and ownership

InfraForge uses Better Auth 1.7.7 with its Prisma adapter and PostgreSQL sessions.
Google and GitHub OAuth are the supported sign-in direction. Password sign-in,
automatic account linking, cookie session caching and optional auth plugins are
disabled. An unconfigured provider never appears as a working sign-in option.

The [1.7.7 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.7)
includes September 30 security fixes, including OAuth-state handling. Consult the
[official advisories](https://github.com/better-auth/better-auth/security/advisories)
before changing the pinned version. The installed Prisma adapter declares Prisma
7 support. The Express 5 auth handler runs before JSON parsing, following the
[Express integration](https://better-auth.com/docs/integrations/express) and
[Prisma adapter](https://better-auth.com/docs/adapters/prisma) documentation.

## Configuration

Set these through the environment or the gitignored `apps/backend/.env` for local work:

| Variable | Meaning |
| --- | --- |
| `BETTER_AUTH_SECRET` | Stable random secret of at least 32 characters, shared by API and WebSocket processes; no default |
| `BETTER_AUTH_URL` | Exact public API origin, such as `http://localhost:3000` locally; no path or trailing slash |
| `APP_ORIGINS` | Comma-separated exact frontend origins, such as `http://localhost:5173`; no wildcard or path |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Both required to enable Google |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Both required to enable GitHub |
| `DATABASE_URL` | PostgreSQL connection for API, WebSocket server and worker |

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
settings require a release rehearsal; Compose does not supply a production proxy.
Compose keeps Redis on its private service network with no host-published port.
Do not expose Redis or its control/event channels to public clients.

Register exact provider redirect URLs:

- Google: `<BETTER_AUTH_URL>/api/auth/callback/google`
- GitHub: `<BETTER_AUTH_URL>/api/auth/callback/github`

Provider consent configuration and externally registered credentials belong to the
owner. No OAuth login is verified merely by installing the library or creating a
session fixture. Without credentials, the UI reports that sign-in is unconfigured.
With account linking disabled, using another provider for an existing email may
require the original provider; InfraForge does not silently merge identities.

## Access rules

Protected HTTP routes read identity from the current database session. Every
design/run query and mutation filters by the verified design owner. Client `userId`
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
The current deployment workflow does not apply migrations; promotion must wait
until the owner has rehearsed and approved that migration/startup sequence.
It adds the four auth tables and a nullable `Infrastructure.ownerId` foreign key.
Existing historical `userId`, layouts, runs, inputs and checkpoints are preserved.
Existing designs receive no guessed owner and are quarantined. Workers refuse
ownerless jobs and retire interrupted/ownerless active runs with a clear reason;
they do not reconstruct or resume a legacy simulation.

Recover only a specific design after establishing independent ownership evidence.
The historical `test-user` marker alone proves nothing. The target must already
exist with verified email, the design must still be unassigned, its historical
marker must match, and it must have no active runs. The database also rejects
reassignment of an owned design. Recovery preserves historical fields and original
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
and signed sessions are created through Better Auth's actual database adapter;
the HTTP and WebSocket services enforce their normal checks. There is no test login
endpoint, fake provider or disabled protection. Tests cover two users, forbidden
reads/writes/controls/subscriptions, rejected origins, expiry, revocation, actual
sign-out, legacy quarantine, worker refusal and dry-run-first recovery. Rejected
commands must leave domain rows/outbox unchanged and publish no simulator controls.
The existing lifecycle and all 30 engine goldens continue to verify B0.2 behavior.
