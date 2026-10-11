# InfraForge project state

Verified 2026-10-11 on `develop`. B0.6D corrects the pre-rehearsal safety gates atop
B0.6C's PostgreSQL 18 cutover proof. B0.2 run consistency, B0.3 authentication,
B0.4 workspaces and B0.5 release behaviour remain intact. Local proof does not
establish hosted production readiness.
See [setup](../Readme.md), [cutover/release](DEPLOYMENT.md),
[authentication](AUTHENTICATION.md) and [integration](../apps/backend/tests/integration/README.md).

## Product and engineering principles

The learning loop is **Challenge → Build → Predict → Run → Break → Understand →
Improve → Run again**. Complete this journey before expanding into unrelated scope.
Beginner support needs contextual teaching and progressive disclosure while keeping
advanced workflows quick; it is a direction, not a claim of current completeness.

Simulation results are authoritative. Separate recorded observations, interpretations
and unknowns. Preserve deterministic outcomes for identical inputs and ordered
controls. Keep domain rules, catalog prices and tuning in their owning packages.
Do not invent telemetry or provider guarantees. This is an educational model,
not production capacity-planning advice.

Controls need understood real-world meaning, authoritative research, meaningful model
effects and honest simulation representation. Distinguish facts, industry practice,
the implemented model, approximations and unknowns; use appropriate technical books
and primary sources. Preserve working save/deploy/live-edit behaviour when redesigning.
Keep the visual identity clear, restrained and polished.
Important UI changes need flow/design review, browser/accessibility checks and independent
visual review. Expert review alone does not prove beginner learning.

Inspect existing work; keep modules readable and migrations additive. Use meaningful
regressions and disposable cross-service integration tests. Owner policy is one
mutating executor, owner Git identity and no inner reviewer without explicit scoped
authorization. Never expose credentials, rewrite published history or promote/deploy
main as routine develop work. Production operations need separate authorization.

## Accepted architecture

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | React 19/Vite/Zustand canvas, deployment and monitoring UI |
| `apps/backend` | Express API, Prisma/PostgreSQL, outbox/BullMQ, worker/simulator and WebSockets |
| `packages/domain` | Resource/workload types, topology rules, readiness and examples |
| `packages/catalog` | Provider SKU data and lookup |
| `packages/contracts` | Deployment, immutable inputs, infrastructure, telemetry and events |
| `packages/simulation` | Deterministic engine, runtime, cost, capacity and tuning |

Bun 1.3.14/Turbo 2.11.6 own one root install/lockfile and explicit workspace exports.
Browser imports cannot reach simulation engine/runtime/cost. Prisma 7.9.1 and all ten
original migrations are unchanged.

Better Auth 1.7.7 validates database sessions and strict HTTP/WS ownership with exact
Origins. Cookies are host-only, HttpOnly, SameSite=Lax and Secure on HTTPS. Frontend,
API and WS must be same-site; API/WS share a hostname. WS closes on session expiry or
revocation. Google/GitHub credentials remain owner configuration. Ownerless designs
are quarantined; recovery defaults to dry run and never fabricates identity.

Creation stores validated topology, resolved workload and seed. Gates/startup/retries
use those immutable inputs. Saved design, original input and revisioned live topology
stay separate. One session advisory lock owns simulation work. Interrupted runs fail
explicitly and preserve diagnostic checkpoints; recovery/replay is not implemented.

## Last hosted observation and first-cutover direction

B0.6A/B observed legacy SHA `6b465c6`, Neon PostgreSQL 18.6 and successful migrations
1–8 with matching checksums; migrations 9/10 and authentication tables were absent.
There were 28 historical `test-user` infrastructures, 331 deployments (223 completed,
8 failed, 4 live, 96 torn-down) and 348 completed outbox rows. Three live simulations
advanced; the fourth was unknown. Public legacy API/WS return Nginx maintenance 503.
Old containers/worker remained running; containment did not fence writers or change data.
The shared Neon pooler had no established session-preserving guarantee.

Chosen order: fence every legacy writer → disposable production-clone rehearsal and
restore/fallback proof → as-found recovery point → explicitly retire the four runs →
pre-migration recovery point/custom dump/restore → migrate primary 9/10 → authenticated
backend → staged same-site frontend/OAuth smoke → frontend promotion. Recollect hosted
truth during the authorized window; historical counts are not a current live census.
Ownership stays NULL; old checkpoints are diagnostic. B0.6C did not access or change
production infrastructure/data/settings or promote main.

## Cutover and release tooling

Read-only evidence uses repeatable-read/UTC, schema definition hashes and application
content hashes; it excludes auth tokens, query text and payloads. Exact migration-eight
catalog and installed Prisma comparisons detect drift. Visible column order survives
dump/restore; exact reserved-schema prefixes prevent user schemas being overlooked.
Reference initialization requires an explicit empty local disposable database.

Retirement defaults to dry run. Applying requires explicit unique IDs and actual
writer-fencing acknowledgement/evidence. Serializable transaction, table/row locks,
exact live set, idle outbox and no other client/worker checks precede four-row retirement.
Only status/update time/operator timeline change; inputs, checkpoints, history and
historical ownership remain intact. Mismatch/failure rolls back completely.
R1 now acquires deterministic NOWAIT table locks after only BEGIN/local settings,
before any snapshot query; retirement timestamps use transaction-local UTC.

External rehearsal requires an independent production identity outside Git plus Neon
API proof of distinct disposable branch/endpoints. It reuses the normal release modules,
pins local Docker context, verifies remote TLS, rejects duplicate/redirecting URL options
and production state paths, and cleans only owned local resources. Hosted execution
is unverified. Restore comparison certifies the pre-auth application contents/history;
role/grant inventory and later authentication backup content need separate proof.
The owner-supplied independent Claude verdict was **B: approve with required
pre-rehearsal corrections** (no critical findings); this task used no inner reviewer.
R2 refuses decoded password-routing prefixes `endpoint=`/`project=` while preserving
ordinary passwords. R3 requires branch-only reset credentials and a rehearsal-only
acknowledgement; production fencing remains separate. Dump passwords use a private
file/container-side 0600 copy rather than Docker environment. The tool cannot compare
production passwords and never receives them. Hosted rehearsal is **NOT EXECUTED**;
primary production migration remains unauthorized.

Release requires a clean exact approved remote-main SHA and manual protected workflow.
Images/acceptance record exact commit/image/auth/migration/settings identities. Maintenance,
API/WS stop, idle recheck and worker stop precede migrations and SQL guard checks.
Start one worker and require real PostgreSQL/Redis/queue/outbox/API/WS readiness before
acceptance. Migration/postcheck failure stays stopped; interruption retains release locks.
Container rollback only restores a recorded compatible image; it cannot undo migrations,
auth/settings changes or runs. The first cutover has no accepted legacy rollback.

Redis stays internal with no host port; API/WS are loopback-only behind trusted TLS.
Worker/migration use direct Neon endpoints; transaction pooling is refused. Stage the
matching frontend without its live domain, verify both artifacts and smoke OAuth/WS,
then promote separately. Repository configuration disables automatic main frontend
deployment; actual hosted settings still require owner verification.

## Executed local verification

| Check | Result |
| --- | --- |
| Frozen Bun install | 491 installs/545 packages checked, no changes |
| Typecheck | Seven workspace tasks and release-operator compiler passed |
| Lint/boundaries | Five ESLint tasks; 988 imports, no cycles/runtime leaks |
| Workspace tests | 101 passes, 743 assertions, zero failures; five DB cases separately executed below |
| Engine goldens | All 30 freshly passed; expectations/source unchanged |
| Tooling tests | 23 passes, 279 assertions, zero failures; routing, distinct acknowledgements and Neon identity/state guards |
| Dependency audit | Exit zero, `{}` |
| Controlled frontend build | Five tasks, 2,103 modules; SHA/auth/HTTPS/WSS artifact verified; existing 593.06 kB / 181.51 kB gzip warning |
| PostgreSQL 18.6 integration | 11 passes, 770 assertions, five files, zero failures; cleanup confirmed |
| Docker packaging | Frozen-install/Prisma image, Compose and five entrypoints passed |
| PostgreSQL 18.6 release rehearsal | All 27 phases passed; owned resources removed |
| Workflow validation | B0.6C Actionlint 1.7.12 proof retained; workflows unchanged |

Database proof includes SELECT-only evidence, baseline PASS and intentional column/user
schema FAIL, atomic retirement refusals/rollback, eight-to-ten migrations and quarantine.
R1 regressions include real NOWAIT writer conflict (SQLSTATE 55P03, under two seconds),
held worker lock, short history, non-array timeline, processing/running outbox and
UTC timestamps from a non-UTC session. Independent M1 proof applies untouched 1–8
SQL using real Prisma deploy/history in a fresh DB, then matches the reference catalog.
The dump wrapper authenticated against local PostgreSQL with an escaped synthetic
password, refused the wrong password and exposed no password in tools environment.
PostgreSQL 18 custom dump SHA-256 was stable through separate atomic restore; source,
restored catalog/history/counts/content matched and deliberate corruption failed.
Two real sessions exercised cross-user HTTP/WS denial with zero domain mutations or
controls. B0.6C's local PostgreSQL/Docker fixture worker SIGKILL released its lock in
611 ms; one replacement acquired it in 3,497 ms (10-second bound). These are not
Neon-hosted measurements. Session pooling passed; real transaction pooling failed.
B0.6D repeated the local worker proof: 707 ms release, 4,123 ms replacement, one owner.
Exact-image rollback, unhealthy release, dependency loss, trusted TLS, Secure sessions,
WS revocation/Origins and interrupted migration-helper cleanup all executed.

Failed attempts remain separate evidence. B0.6D corrected a test-only cross-workspace
import and proved the Docker Desktop password-file permission fix without loosening
boundaries or authentication checks; final complete suites passed afterward.

## Remaining hosted gates and product risks

1. After all B0.6D exact-SHA CI jobs pass, run the approved disposable clone rehearsal
   with branch-only reset credentials. Primary writer fencing/retirement remains
   separately authorized; inspect/terminate old sessions regardless of rotation behaviour.
2. Prove hosted recovery branches/custom restoration, role/grants, retention/fallback
   and direct Neon lock release/replacement timing before primary migrations 9/10.
   Primary review must also cover rules/pg_rewrite, types/domains/enums, owners/grants/
   default privileges, inheritance, publications, role/database settings and sequence
   parameters. These remain open primary-cutover gates, not disposable-rehearsal blockers.
3. Configure EC2/Nginx/DNS/TLS renewal, loopback/security groups, private same-database
   endpoints, stable auth secret and exact same-site origins. Verify real Google/GitHub
   callbacks/session/WS/run smoke; OAuth was not end-to-end tested without credentials.
4. Verify GitHub production approval/main restrictions/SSH fingerprint and Vercel root
   `apps/web`, outside-root source, Bun/build settings, parked legacy frontend and
   controlled staging/promotion. Require all nine exact-SHA develop CI jobs before acceptance.
5. Hosted WS/database load, process-local rate budgets and host/container patching
   remain unproved. Bundle size, semantic SKU validation, corrupt legacy drafts,
   beginner/narrow-screen/focus behaviour, reports/settings stubs and meaningful
   queue/monitor/history/live-edit feedback remain scoped product follow-ups.

## Evidence and hygiene

Owned integration/rehearsal containers, volumes, networks, derived/base test images,
dumps, schemas and temporary scripts were removed. Four stale Windows launchers from
the earlier force-killed failed run were identified and removed with PID/time checks.
Forced termination can leave detached descendants; inspect the recorded run before
recovery cleanup. No test PostgreSQL/Redis or Bun launcher remains. Unknown stopped
Docker resources and useful shared images/caches were preserved.

Unique integration/runtime/rehearsal/build/tooling evidence remains in OS temporary
storage, outside Git. Original founder notes/unique historical evidence remain in
ignored `docs/evidence.local/`. Required dependencies/generated Prisma/environment
files remain. No agent-memory folders, scratch archives or separate project memory
were created; this document is the main durable project state.

Next: approved disposable hosted clone/restore rehearsal with branch-only credentials,
then provider session/TLS/fallback/OAuth proof before a separately approved primary cutover.
