# InfraForge project state

Verified locally 2026-10-13 on `develop`. **Reliable Run Evidence is implemented.**
Product development remains local-first; hosted production cutover is **PARKED**.
This milestone did not access Neon, EC2/AWS, hosted Nginx, Vercel, DNS, OAuth settings,
production secrets/databases or `main`.

See [local setup](../Readme.md), [authentication](AUTHENTICATION.md),
[integration tests](../apps/backend/tests/integration/README.md) and the existing
[release procedure](DEPLOYMENT.md). This document is the main project state;
do not create executor memories or planning archives.

## Product direction and policy

The learning loop is **Challenge → Build → Predict → Run → Break → Understand →
Improve → Run again**. Complete it before expanding scope. Preserve the visual
identity; deeper UX redesign comes later. Progressive disclosure should help
beginners without slowing advanced workflows.

**Observed / Interpreted / Unknown is permanent.** Results describe an educational
model, not production sizing or cloud bills. Interpretations need deterministic
retained evidence; never invent telemetry, causality, provider guarantees or recovery.
Keep modules small, boundaries explicit, migrations additive and published history intact.
One mutating executor uses the owner Git identity. Approved policy: GPT-6.1 Sol,
Extra High; INNER NONE. External review requires scoped owner authorization.
Normal develop work cannot promote/deploy main or operate on production data.

## Accepted architecture and local foundation

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | React 19/Vite/Zustand canvas, monitoring, history and reports |
| `apps/backend` | Express, Prisma/PostgreSQL, outbox/BullMQ, worker/simulator, WS and report derivation |
| `packages/domain` | Resource/workload types, graph/readiness rules and examples |
| `packages/catalog` | Provider SKU data and lookup |
| `packages/contracts` | Deployment, inputs, actions, telemetry/events and report DTOs |
| `packages/simulation` | Deterministic engine, runtime, cost, capacity and tuning |

Bun 1.3.14/Turbo 2.11.6 own one root install/lockfile. Browser imports cannot reach
engine/runtime/cost. Prisma 7.9.1 now has eleven migrations: the original ten are
unchanged, followed by `20261013000000_reliable_run_evidence`. All 30 engine goldens,
expectations, RNG consumption and simulation behavior remain unchanged.

Better Auth 1.7.7 uses database sessions and exact HTTP/WS ownership and Origins.
Cookies are host-only, HttpOnly, SameSite=Lax and Secure on HTTPS. WS checks expiry,
revocation and run ownership. Ownerless history stays quarantined; dry-run-first
recovery requires independent evidence and assigns only linked inactive unassigned
runs alongside their verified design. Detached ownerless runs remain quarantined.
Google/GitHub OAuth still requires owner credentials and end-to-end verification.
There is no public fixture-login endpoint or browser identity bypass.

`bun run dev:setup` prepares labelled PostgreSQL 18/Redis 8 resources. `bun run dev`
migrates/generates and supervises API, worker, WS and frontend using generated local
configuration, ignoring app dotenv/hosted settings. Ports 55432/56379 and
3000/3001/3002/5173 bind to loopback. Unknown resource/port collisions are refused.
The accepted four-process and listener smokes preserve persistent developer storage;
a dedicated bridge supports Docker Desktop host probes. These are completed local
foundation checks, not an ongoing hosted-release milestone.

## Reliable Run Evidence

Creation captures RunInputs V2: validated topology, fully resolved workload, seed,
model version `1` and catalog snapshot `2026-08`. Gates, initialization and retries
use those immutable inputs. V1 remains readable without reconstructed metadata.
A V2 model/catalog mismatch refuses execution rather than silently changing context.
Saved design, original input and revisioned accepted/applied live topology stay separate.

`RunAction` is a bounded, deployment-specific record for load, speed, chaos, vertical
scale, pool scale, topology and teardown. Owner/live/target/SKU/pool/revision checks
precede insertion. PostgreSQL row locking allocates a unique per-run sequence;
HTTP returns 202 with the requested action ID. The worker polls PostgreSQL on its
one-second cycle, including while paused. Redis carries optional notifications,
not simulator control truth. Reports show the latest 500 actions with an omission
notice; earlier records remain in the database.

Lifecycle: **requested → applying → running/completed**, or **failed/cancelled**.
Claiming precedes memory application. An acknowledgement write failure freezes that
exact memory state and retries its write, never reapplies the action. SQL guards
protect request identity/parameters and closed outcomes. A session advisory lock
still permits one worker. Restart atomically fails interrupted runs and unfinished
actions; uncertain effects remain unverified. There is no replay or checkpoint resume.

Load/speed outcomes retain previous and applied values. Chaos retains actual start,
logical duration/end and observed end health; **fault ended is not system recovery**.
Vertical scaling completes only after the requested SKU is installed and observed
online. Pool scaling records the actual replica transition and final count.
Topology retains both accepted and simulator-applied revision. Successful action
phases lacking their required outcome evidence are omitted as malformed in reports.

Teardown is durable and idempotent. The simulator deep-captures its current state
once, then atomically persists the terminal snapshot, action completion, cancellation
of unfinished controls, `torn-down` and `runtimeActive=false`. Only after commit does
it remove memory. Failed writes freeze/retry that capture. An unavailable worker
leaves teardown requested and has no terminal snapshot; restart fails it explicitly.
The frontend says **Stopping…** until confirmed completion.

New wall-minute checkpoints include actual `capturedAt` and applied topology revision.
Terminal captures also retain simulated seconds, cost, health, resource measurements,
load/speed, live topology, installed SKUs, pool/fault/restart state and measurement
computation time/revision. Exact state can contain initialized or older measurements;
reports label that explicitly. `updatedAt` is never treated as measurement time.
Old timestamp-less checkpoints remain unknown and are never called final state.

Runs own their nullable `ownerId` and captured `runName`. Migration backfills only
from the linked design's already verified owner/name, preserving unassigned legacy
ownership and all previous fields. Legacy backfilled names are not claimed to be
original creation names. The nullable design FK uses SET NULL. Active deletion is
blocked through HTTP and SQL; inactive design deletion preserves run/report/action
history and its original owner. Run/control/report/WS authorization uses run ownership.

Existing reports retain Observed / Interpreted / Unknown and add action phase,
parameter, wall/logical timing and outcome disclosure, V2 provenance and clearly
separate exact terminal vs diagnostic checkpoint evidence. Legacy chaos arrays
remain request-only. No charts, LLM explanations, rerun or comparison UI were added.

## Verification and local QA

| Check | Actual local result |
| --- | --- |
| Frozen install | 491 installs/545 packages checked; no lockfile changes |
| Typecheck | Seven workspace tasks and release compiler passed; final run serialized after local memory pressure |
| Lint/boundaries | Five ESLint tasks; 1,152 imports, no cycles/runtime leaks |
| Workspace tests | 132 passed, 952 assertions; six DB cases executed separately below |
| Engine goldens | All 30 passed; engine source/expectations unchanged |
| Tooling | 23 passed, 279 assertions |
| PostgreSQL 18/Redis integration | 12 passed, 1,047 expect calls across six files; cleanup confirmed |
| Frontend build | Passed; existing bundle-size warning remains |
| Final report rendering | Seven SSR tests, 50 assertions passed after final wording |
| Dependency audit | Exit zero, `{}` |
| Committed Docker packaging | Image `f2de3dc`; five entrypoints compiled, all 27 disposable compatibility phases passed |

Real database-backed session HTTP/WS scenarios covered normal runs, load, all scaling,
chaos, topology, pause/resume, teardown, restart, two-user/ownerless denial and zero
unauthorized actions/mutations. Redis PUBLISH denial did not lose a load action.
Concurrent requests retained stable sequence; two forced acknowledgement failures
after memory application did not apply load twice. A topology claim failure retained
acceptance without falsely claiming application. Two failed terminal writes left the
run live with no terminal record; retry committed the original capture timestamp.
Offline teardown/restart stayed honest.

The recorded example had 18 actions: crash at second 0 ended at 30 while overall
health was still critical; vertical scaling was observed online at 21; pool count
went 2→3 at 60 and 3→2 at 75. Teardown captured healthy state at second 80, revision 1,
with the real wall timestamp. Renaming/deleting the design retained its original run
name, report and owner-only HTTP/WS access. The browser inspected the actual recorded
report using application components/CSS, keyboard disclosures and retained history.
This verifies report rendering, not authenticated SPA/OAuth sign-in without credentials.

Failed attempts were retained separately: Docker initially stopped; Bun's native
SQL rejection matcher stalled and was replaced by Node's awaited assertion; restart
retirement initially exposed run failure before action failure and is now atomic;
the old migration-count assertion and new test enum literals were corrected. The
first image command selected the wrong builder; the verified local engine build passed.
A concurrent compiler attempt exhausted local memory; the final unchanged checks
passed serially after owned stack cleanup.
No golden, protection or validation requirement was weakened.

## Evidence, cleanup and parked hosted work

Sanitized evidence stays outside Git in OS temporary storage:
`infraforge-run-evidence-c943b5fd14674aad` plus owned integration run records.
Disposable PostgreSQL/Redis containers, volumes/networks, fixture rows/sessions and
child processes were removed. The temporary report server/tab, its script, three
superseded successful check logs (9,711 bytes total scratch) and unused labelled test
image were removed. Unique final/failed evidence and the inspection screenshot remain.
Developer storage/configuration and shared caches
remain intentionally, with unknown resources and owner files preserved. No agent
memory folder or permanent scratch archive was added.

B0.6E remains stopped before database access, with identity/reset-credential gates
unfinished. A retained hosted rehearsal child and existing private operator record
need future authorized inspection/cleanup; this task did not reopen them.
Last historical hosted facts: legacy SHA `6b465c6`, Neon PostgreSQL 18.6, migrations
1–8, 28 `test-user` designs, 331 deployments (223 completed, 8 failed, 4 live,
96 torn-down), 348 completed outbox rows. Three simulations advanced; the fourth
was unknown. Public API/WS had maintenance containment while legacy writers remained.
These are historical facts, not a fresh census. Future cutover needs renewed writer
fencing, database/restore truth, session-preserving worker connections and OAuth/TLS.

## Remaining limits and next product milestone

Next: **honest Rerun + Compare**, using trustworthy original inputs, actions and
snapshots. Same seed alone does **not** establish a perfectly controlled comparison
across changed topologies: the engine consumes seeded jitter sequentially across
resources. Future comparison must address or explicitly grade that comparability;
do not change RNG/goldens merely to claim fairness.

Continuous telemetry, all automatic scaling events, causal effects and checkpoint
recovery remain absent. Exact terminal state is an educational-model observation,
not production recovery or sizing proof. Browser OAuth/complete authenticated SPA
QA, beginner/narrow-screen UX and bundle size remain separate work. Local tests do
not establish production readiness; hosted work stays parked.
