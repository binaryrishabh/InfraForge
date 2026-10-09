# InfraForge project state

Verified 2026-10-10 on `develop`. B0.5 adds a controlled release process while
preserving B0.2 run consistency, B0.3 authentication and the B0.4 monorepo.
See [setup](../Readme.md), [release instructions](DEPLOYMENT.md),
[authentication](AUTHENTICATION.md) and [integration tests](../apps/backend/tests/integration/README.md).
Local verification does not establish production readiness.

## Product and engineering principles

The learning loop is **Challenge → Build → Predict → Run → Break → Understand →
Improve → Run again**. Complete this journey before expanding into unrelated scope.
Beginner support is a direction, not a claim of current completeness; use contextual
teaching and progressive disclosure while keeping advanced workflows quick.

Simulation results are authoritative. Explanations must separate recorded observations,
interpretations and unknowns. Preserve deterministic outcomes for identical inputs and
ordered controls, and keep shared domain rules, catalog prices and simulation tuning
in their owning packages. Do not invent telemetry or provider guarantees.

Infrastructure controls need understood real-world meaning, sufficient research,
meaningful model effects and an honest simulation representation. Research must
distinguish facts, industry practice, the implemented model, approximations and unknowns;
use authoritative sources appropriate to the question, including technical books.

The interface may be redesigned within approved scope while preserving working
save/deploy/live-edit behaviour. Aim for a clear, restrained, polished visual identity.
Important UI changes need flow/design review, browser and accessibility checks, and
independent final visual review. Expert review alone does not prove beginner learning.

Inspect source and existing work before editing. Keep changes focused, modules readable
and migrations additive. Validate affected behaviour with meaningful regressions;
cross-service changes require disposable integration tests. Never expose credentials,
modify production without explicit authorization, rewrite published history or promote
main as part of routine develop work.

## Accepted architecture

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | React 19/Vite/Zustand canvas, deployment and monitoring UI |
| `apps/backend` | Express API, Prisma/PostgreSQL, transactional outbox/BullMQ, worker/simulator and WebSocket server |
| `packages/domain` | Resource/workload types, topology rules, readiness and examples |
| `packages/catalog` | Curated provider SKU data and lookup functions |
| `packages/contracts` | Deployment, immutable input, infrastructure, telemetry and event contracts |
| `packages/simulation` | Deterministic engine, runtime, cost, capacity and tuning |

Bun 1.3.14/Turbo 2.11.6 own one root install and lockfile. Workspaces use explicit
exports; browser imports cannot reach simulation engine/runtime/cost. Prisma 7.9.1
and all ten original migrations retain their contents.

Better Auth 1.7.7 uses database sessions, exact Origins and strict HTTP/WS ownership.
Google/GitHub require configured credentials. Cookies are host-only, HttpOnly,
SameSite=Lax and Secure on HTTPS; frontend/API/WS must be same-site, with API/WS
on the same hostname. Expiry/revocation closes WS access. Legacy owners are never
invented; ownerless designs remain quarantined and recovery defaults to dry run.

Deployment creation captures validated topology, resolved workload and seed.
Gates/startup/retries consume these immutable inputs. Saved design, original input
and revisioned live topology stay separate. A session advisory lock permits one
simulation worker. Interrupted runs fail explicitly; checkpoint recovery/replay is
not implemented. Engine/catalog results and simulated time determine outcomes/cost.
This remains an educational model, not production capacity-planning advice.

## Release behaviour

The manual workflow requires an approved full remote-main SHA, validates that exact
revision and uses a pinned SSH host identity. A develop push only runs CI. Images
record the commit, auth contract and migration fingerprint; acceptance records exact
image IDs. Retained accepted SHAs cannot be rebuilt/retagged by the release command.

Preflight verifies all database endpoints reach the same database, unchanged migration
history and inactive runs. Nonempty databases older than the first eight migrations
need a separate data-preserving plan. Public API/WS enter verified TLS maintenance;
API/WS stop, idle runs are rechecked, then the worker drains before releasing its lock.
Installed Prisma deploy/status/diff commands and SQL-trigger checks must pass before
one worker and matching API/WS containers start. Real readiness requires PostgreSQL,
Redis, schema guards, and worker ownership/queue/outbox processing as appropriate.
Older guarded workers refuse incompatible history. Worker connections must preserve
sessions; known transaction-pool configurations and a real transaction pooler are rejected.
Provider verification is still required for transparent proxies.

Migration/postcheck failure leaves services stopped. Failed mutations and interruption
retain the release lock; owned migration helpers are stopped. The proxy maintenance
marker requires traversable host directories (`0711` state directory); accepted state
and lock files are private. Container rollback requires a recorded image with identical migration, auth
and settings fingerprints. It never reverses a database migration, auth change or run.
Authentication compatibility versions must be maintained and reviewed explicitly.

Redis has no host port and stays on an internal Compose network. API/WS publish only
to loopback behind the single trusted TLS proxy. Vercel automatic main deployment is
disabled in repository configuration. Stage a frontend from the approved SHA without
assigning the live domain; accept the backend, compare both artifacts' SHA/auth/public
endpoints, perform owner smoke tests, then promote the frontend separately.

## Verification

| Check | Actual result |
| --- | --- |
| `bun install --frozen-lockfile` | Pass; 491 installs/545 packages, no changes |
| `bun run typecheck` | Seven workspace tasks plus release-operator compiler passed |
| `bun run lint` | Five tasks passed; backend has no lint script |
| Boundary checks (inside lint) | 942 imports; no file/workspace cycles or browser runtime leaks |
| `bun run test --force --concurrency=2` | 97 passes, zero failures; three integration cases gated in this command |
| Engine goldens | All 30 freshly executed and passed; expectations unchanged |
| `bun run test:tooling` | 15 passes, 50 assertions, zero failures |
| Controlled `bun run build` | Five tasks; 2,103 modules; JS 593.06 kB / 181.51 kB gzip; existing chunk warning |
| Frontend artifact | Exact fixture SHA, auth contract and HTTPS/WSS endpoints verified in emitted `release.json` |
| `bun run audit` | Exit zero, `{}`; dependency audit only |
| `pwsh ./scripts/test-integration.ps1` | Nine passes/345 assertions, zero failures; all three normally gated cases executed; cleanup confirmed |
| Docker image/Compose | Final image built with frozen Linux installation, Prisma generation and embedded identity; API, worker, WS and recovery CLI bundled (1,341 modules) |
| Disposable release rehearsal | All 25 phases passed; actual migrations/failures, backup/restore, legacy records, competing workers, incompatible history, active runs, drift/guards, image rollback, health failures, Redis/PostgreSQL loss, session/transaction poolers, TLS/session/WS security, interruption and teardown |
| Host file permissions | Unprivileged Linux process could stat maintenance but could not read private accepted state |
| Workflow syntax | Actionlint 1.7.12 passed; official archive checksum verified |
| B0.5 published-SHA CI | Pass at `4d145d1`; [completed run](https://github.com/binaryrishabh/InfraForge/actions/runs/37980676263) |

Initial Windows integration attempts failed (8 passes/1 failure and 6 passes/3 failures)
and a concurrent frontend build exhausted memory while Docker became unresponsive.
Sequential reruns passed; no Docker restart was performed by this task. Intermediate
rehearsals exposed a Docker-builder context mismatch, bind-mount directory creation
order and an incorrect WSS fixture CA option. Those were corrected and the complete
rehearsal passed with certificate verification enabled. An initial image installation
failed extracting a Bun dependency tarball; an unchanged retry built successfully.
These failed attempts are not counted as successful validation.

## Owner requirements and remaining risks

1. Retire every old unauthenticated service/worker and park the incompatible frontend.
   Historical active ownerless runs require a separately approved retirement plan;
   this release does not silently rewrite them. The first release has no accepted rollback.
2. Configure EC2/Nginx, DNS/trusted TLS and renewal, loopback exposure/security groups,
   explicit same-database URLs, provider-verified session mode and PostgreSQL TLS.
   Prove hosted backup restoration before release; local restore mechanics are verified.
3. Provision a stable random auth secret and exact same-site public origins. Register
   Google/GitHub credentials and exact callback URLs. Real OAuth flows remain untested
   without external credentials; database session fixtures do not establish OAuth success.
4. Configure GitHub production approval/branch restrictions and SSH fingerprint.
   Set Vercel root `apps/web`, include source outside that root, verify Bun/build settings,
   disable old automatic production deployment and test controlled staging/promotion.
   Hosted settings, actual EC2 networking and Vercel promotion were not verified or changed.
5. Verify hosted WS/database load, process-local rate budgets and host/container patching.
   Existing bundle size, semantic SKU validation, corrupt legacy drafts/layouts and
   unfinished beginner/narrow-screen/focus behaviour remain follow-up work. Reports/settings are stubs.

Product follow-up includes evidence-based run reports and deployment history,
meaningful queue/monitor behaviour, clearer feedback on live edits and remaining
canvas usability gaps. These need scoped design and model validation; old era
schedules and claims of completed product polish are superseded.

## Evidence and cleanup

Owned test containers, volumes, networks, derived images, the local test image and
unused interrupted-fixture copies were removed during B0.5. Unique B0.5 integration
logs/runtime JSON remain in OS temporary storage as evidence. Its final Linux CI
result is linked above.

Project state is maintained here. Obsolete local role instructions, planning templates
and repository-specific tool overrides were removed at the owner's request. Retained
historical verification evidence and original founder notes are in `docs/evidence.local/`,
which is ignored by the existing `*.local` rule and must remain unpublished. Redundant
archives, screenshots, review packets and unused frontend build caches were removed.
Superseded progress/vision notes, unmeasured resume-metric claims and unused
Redis/WebSocket tutorial examples were also removed at the owner's request.
Required dependencies, generated Prisma files and environment files
remain; unrelated resources were untouched.

Next: owner configuration and hosted OAuth/TLS/backup/session-pooling smoke tests,
then review the promotion to main and an approved maintenance release. No production
secrets, hosted settings, production data, main branch or deployment were changed.
