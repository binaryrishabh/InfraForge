# InfraForge project state

Verified 2026-10-09 on `develop`. B0.4 consolidates the monorepo while preserving
B0.2 run consistency and B0.3 authentication. See [setup](../Readme.md),
[authentication](AUTHENTICATION.md), [deployment settings](DEPLOYMENT.md) and
[disposable integration tests](../apps/backend/tests/integration/README.md).

## Accepted architecture

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | React 19/Vite/Zustand canvas, deployment and monitoring UI |
| `apps/backend` | Express API, Prisma/PostgreSQL, outbox/BullMQ, worker/simulator and WebSocket server |
| `packages/domain` | Resource/workload types, topology rules, readiness and examples |
| `packages/catalog` | Curated provider SKU snapshot and lookup functions |
| `packages/contracts` | Deployment, immutable run-input, infrastructure, telemetry and event contracts |
| `packages/simulation` | Deterministic engine, runtime types, cost calculations, capacity and tuning |

Bun 1.3.14/Turbo 2.11.6 own one root installation and `bun.lock`. Internal imports
use explicit exports and `workspace:*` dependencies. Contracts depend on domain;
simulation depends on domain, catalog and contracts. Browser code may use simulation
capacity/tuning, but cannot reach its engine, runtime types or cost implementation.
Source exports work directly with Bun/Vite. Root `shared`, `Backend`, `Frontend`,
their aliases and legacy boundary exception files are removed. Prisma generation
runs before backend tests/typechecking; generated files remain untracked. All ten
versioned migrations and the schema retain their contents.

Better Auth 1.7.7/Prisma 7.9.1 provide database sessions and configurable Google/GitHub
OAuth. HTTP requires verified ownership; unsafe requests require an exact permitted
Origin. WebSockets check Origin/session before upgrade, ownership before subscription
and delivery, and expiry/revocation every second. Cookies are host-only, HttpOnly,
SameSite=Lax and Secure on HTTPS. Production requires exact HTTPS origins, same-site
frontend/API/WS and the same API/WS hostname. Redis has no Compose host port.
Passwords, implicit account linking and optional auth plugins are disabled.
Ownerless historical records stay quarantined; ownership recovery requires evidence,
a verified account and an inactive design, and defaults to dry run. Browser drafts
use server user IDs; account changes clear requests, canvas and monitoring state.

Deployment creation transactionally captures validated topology, resolved workload
and seed. Gates, startup and retries consume these immutable inputs. Saved designs,
original inputs and revisioned live topology are separate; reattachment reads live
state without overwriting it. One worker holds a PostgreSQL session advisory lock.
Active design deletion requires runtime stop acknowledgement. Worker interruption
explicitly fails affected runs and preserves diagnostic checkpoints; checkpoint
recovery/replay is not implemented. Outcomes and costs come from engine/catalog data
and simulated time. Wall-clock metadata is not byte-identical replay, and the model
is educational rather than cloud capacity-planning advice.

## Verification

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Pass; 491 installs/545 packages checked, no changes |
| `bun run typecheck` | Seven tasks passed, including Prisma generation |
| `bun run lint` | Five lint tasks passed; backend has no lint script |
| `bun run check:boundaries` | 903 value/type imports; no file/workspace cycles or browser runtime leaks |
| `bun run test:tooling` | Eight tests, 22 assertions, zero failures |
| `bun run test` | 94 passes; three integration tests intentionally gated in this command |
| Engine goldens | All 30 passed; only import paths changed, expectations unchanged |
| `bun run build` | Five tasks; 2,103 modules; JS 593.04 kB / 181.49 kB gzip; existing chunk warning |
| `bun run audit` | Exit zero, `{}` |
| Disposable integration | Nine passes, 345 assertions; includes the three gated tests |
| Docker/Compose | Image built; API, worker, WS and recovery CLI bundle; actual Compose working directories verified; Redis remains private |
| Browser | Save, deploy, monitor, dashboard reattachment, teardown, two-user isolation, sign-out and session expiry passed; no console errors |
| Linux validation | Nine GitHub Actions jobs cover seven checks, integration and container packaging; final published-SHA result accompanies delivery |

Source comparison checked 249 relocated source/schema/migration files: declarations
and behavior are unchanged after import relocation. Integration exercises real signed
database sessions, cross-user HTTP/WS rejection, expiry/revocation, Origin/CSRF,
legacy quarantine/recovery, immutable inputs, retries, live revisions, worker loss,
restart and deletion. Unauthorized controls cause no mutation or simulator event.
Browser evidence observed nine nodes/eight links at simulated second 262, DNS 278
RPS, database 156 RPS and a spawned replica. Database evidence confirms teardown left
the run `torn-down` with `runtimeActive=false`. Bob saw only his design and an empty
canvas. External OAuth was not tested without provider credentials.

An incomplete intermediate extraction caused missing-module errors and was corrected.
Review also caught stale Compose working directories and missing Turbo auth/database
environment forwarding. Private browser setup attempts encountered a migration timeout,
a Docker network timeout and fixture cleanup/validation errors. The corrected fixture
passed its cleanup regression, including a design created outside its original ID list;
no application security checks were weakened for testing.

## Workspace cleanup

Obsolete plans, source copies, review packets, build contexts and unused skill copies
were removed after inventory and evidence preservation. Three clean, inactive detached
worktrees were removed through normal Git worktree operations. Required local tool
configuration/principles and unique validation/browser/cleanup evidence remain private
and untracked. Owner learning notes and local environment files remain local.
Root dependencies and useful shared caches remain; old per-app installations were
removed and frozen installation rebuilt only the required compiler links. Historical
committed reports remain in Git history; this is the single current-state document.

## Release risks and next milestone

1. Change the Vercel root from `Frontend` to `apps/web`, include files outside that
   root, retain production branch `main`, and verify hosted Bun/build overrides.
   Update external backend working-directory/Dockerfile settings to `apps/backend`.
2. Provision a stable auth secret, exact HTTPS origins and registered Google/GitHub
   credentials/callbacks; verify both real OAuth flows. Account linking remains disabled.
3. Rehearse worker shutdown, additive migrations, quarantine recovery, proxy/TLS,
   health and rollback before release. The deploy workflow does not apply migrations.
   Old unauthenticated services must not remain exposed.
4. Single-worker execution needs session-preserving PostgreSQL connections; transaction
   poolers and full recovery are unsupported. Other live controls lack durable replay.
   Measure hosted WS/database load and proxy-aware, currently process-local rate limits.
5. Existing Windows Bun instability, bundle size, semantic SKU validation, corrupt
   drafts and legacy layouts need focused follow-up. Reports/settings remain stubs;
   beginner UX, narrow screens and modal focus remain incomplete.

Next: configured OAuth end-to-end tests and security/release review, then a migration,
proxy and rollback rehearsal before considering `develop` to `main`. No hosting
settings, production data, secrets or deployments were changed by consolidation.
