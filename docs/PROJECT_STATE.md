# InfraForge project state

Verified 2026-10-12 on `develop`. **Local-first product development is the priority.**
Hosted production cutover is **PARKED** until the local learning experience reaches
stronger V1 quality. The local PostgreSQL/Docker foundation is accepted after the
actual four-process smoke; it is not another ongoing release-hardening milestone.

See [local setup](../Readme.md), [authentication](AUTHENTICATION.md),
[integration tests](../apps/backend/tests/integration/README.md) and the existing
[release procedure](DEPLOYMENT.md). No further hosted verification is planned during
current product development.

## Product direction and policy

The learning loop is **Challenge → Build → Predict → Run → Break → Understand →
Improve → Run again**. Complete it before expanding scope. Preserve the existing
visual identity; deeper UX redesign comes later. Beginner teaching and progressive
disclosure should keep advanced workflows quick.

**Observed / Interpreted / Unknown is a permanent product rule.** Simulation results
are authoritative within an educational model, not production sizing advice.
Interpretations need deterministic evidence and tests; never invent telemetry,
causality, provider guarantees or recovery. Domain, catalog and simulation packages
own their respective rules, prices and tuning.

Keep modules readable, workspace boundaries explicit and migrations additive.
Preserve working save/deploy/live-edit behaviour and published history. One mutating
executor uses the owner Git identity. Approved policy for this milestone: GPT-6.1
Sol, Extra High; INNER NONE. External review requires explicit scoped authorization.
Normal develop work cannot promote/deploy main or operate on production data.
This document is the main project state; do not create executor memories.

## Accepted architecture

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | React 19/Vite/Zustand canvas, deployment, monitoring and reports |
| `apps/backend` | Express API, Prisma/PostgreSQL, outbox/BullMQ, worker/simulator, WS and report derivation |
| `packages/domain` | Resource/workload types, graph rules, readiness and examples |
| `packages/catalog` | Provider SKU data and lookup |
| `packages/contracts` | Deployment, immutable inputs, infrastructure, telemetry, events and report DTOs |
| `packages/simulation` | Deterministic engine, runtime, cost, capacity and tuning |

Bun 1.3.14/Turbo 2.11.6 own one root install and lockfile. Browser imports cannot reach
simulation engine/runtime/cost. Prisma 7.9.1 and all ten original migrations remain
unchanged; all 30 engine goldens and their expectations are unchanged.

Better Auth 1.7.7 validates database sessions and exact HTTP/WS ownership and Origins.
Cookies are host-only, HttpOnly, SameSite=Lax, and Secure on HTTPS. WS closes on
expiry/revocation. Ownerless legacy designs remain quarantined; recovery is dry-run
first and never fabricates identity. Real Google/GitHub OAuth still needs owner
configuration and end-to-end verification; the isolated launcher leaves providers
unconfigured and adds no test-login endpoint.

Creation captures validated topology, resolved workload and seed. Gates, startup and
retries use those immutable inputs. Saved design, original input and revisioned live
topology remain separate. One session advisory lock owns simulations. Worker restart
fails interrupted runs explicitly and preserves diagnostic checkpoints; replay and
checkpoint recovery are not implemented.

## Closed local foundation

`bun run dev:setup` prepares labelled PostgreSQL 18/Redis 8 resources; `bun run dev`
applies migrations, generates Prisma and supervises API, worker, WS and frontend.
Only generated local configuration is used; app dotenv files and hosted settings
cannot select a remote database through the launcher. Data ports 55432/56379 and
application ports 3000/3001/3002/5173 bind to loopback. Unknown Docker resource/port
collisions are refused. Developer PostgreSQL storage is persistent.

The 2026-10-11 smoke used a separately marked disposable database and real Better
Auth fixture sessions. Ten migrations, Prisma generation, API/WS readiness,
frontend load, a surviving single worker, save/deploy/live load control, chaos,
accepted topology edits and teardown all executed. Normal developer data was untouched.
The internal-only development bridge failed host connectivity on Docker Desktop;
the dedicated bridge and host readiness probes corrected it. Readiness now uses
explicit loopback addresses without inherited proxies.

The follow-up listener smoke verified all four listeners on `127.0.0.1` and HTTP
200 from API, WS, worker readiness and frontend. An occupied worker port was refused
before migrations without stopping its listener. Worker readiness now honors the
launcher interface and is checked alongside the other services.

## Run History + Understand Report

Authenticated endpoints:

- `GET /api/deployments/history`: current owner's runs, newest first; bounded cursor
  pagination, workload/source, status/times, resource count, chaos count, revision
  and evidence availability.
- `GET /api/deployments/:deploymentId/report`: owner-only deterministic derivation
  from existing durable records. Other owners and ownerless records return safe 404s.

No new database table or migration was needed. Saved designs never substitute for
original inputs. Malformed history is omitted with explicit limits; ambiguous
topology comparisons produce no inferred edits.

`/reports` provides loading/empty/error/list states and pagination.
`/reports/:deploymentId` uses progressive disclosure for inputs, gates, timeline,
chaos requests, accepted topology changes, checkpoint measurements, cost estimates
and evidence limits. Dashboard shows five recent runs and a history link. User changes,
report changes and page changes discard older request state. Settings stays a stub;
the speculative billing wording was removed.

Observed facts come from stored statuses, stages/events, inputs, accepted revisions
and checkpoints. Interpretations are currently narrow: CPU at least 90% implies at
most ten percentage points of headroom at that checkpoint; original/live topology
differences describe accepted edits. Neither proves duration, cause or application
at the checkpoint. Chaos entries establish recorded requests, not full impact/recovery.
Monthly gate estimates and accumulated simulated checkpoint cost stay distinct.

Checkpoints are retained about once a wall-clock minute, without a capture timestamp.
Teardown does not persist an exact final snapshot. Full telemetry series, intermediate
topology versions and many streamed controls are absent. Reports say so explicitly,
show missing fields as unavailable, and contain no fabricated charts or final health.

## Verification and local QA

| Check | Actual result |
| --- | --- |
| Frozen install | 491 installs/545 packages checked; no lockfile changes |
| Typecheck | Seven workspace tasks plus release-operator compiler passed |
| Lint and boundaries | Five ESLint tasks; 1,052 imports, no cycles/runtime leaks |
| Workspace tests | 118 passed, 853 assertions; five DB cases executed separately below |
| Engine goldens | All 30 passed; source/expectations unchanged |
| Tooling | 23 passed, 279 assertions |
| PostgreSQL 18 integration | 11 passed, 807 assertions, five files; owned cleanup confirmed |
| Frontend build | Five tasks, 2,112 modules; existing bundle-size warning remains |
| Dependency audit | Exit zero, `{}` |
| Final report rendering | Five SSR tests, 40 assertions; final wording/build passed |
| Docker packaging/runtime compatibility | Five packaged entrypoints compiled; 27 disposable local runtime phases passed |

Local QA created normal, chaos, short torn-down and invalid-design runs through
real authenticated HTTP/WS paths. The normal/chaos checkpoints retained simulated
seconds 57/56 and healthy overall state; the chaos report still does not infer a
causal recovery story. One chaos request and topology revision 1 were recorded.
Short/failure reports had no checkpoint; the isolated VM failure kept its actual
reason. Saved-design edits did not alter original report architecture.

The real frontend loaded in the browser. All four report views were inspected
separately using the actual recorded fixture data and application report components,
including keyboard disclosure and readable measurement tables. This is not a claim
of end-to-end OAuth or authenticated SPA browser sign-in without provider credentials.
Real-session API/WS integration covers two users, missing/expired/revoked sessions,
cross-user reports/cursors, ownerless records and zero unauthorized mutations/controls.

Failed attempts remain separate evidence: invalid QA fixture name and a nonexistent
WS assertion field were corrected without weakening product checks. A later Prisma
helper timed out across a recorded sixteen-hour wall-clock gap; the unchanged fresh
full integration rerun passed. Docker context inspection found the new report source
directory missing from its allowlist; the focused packaging correction is committed.
The follow-up web lint process exhausted memory while local stacks ran concurrently;
checks were rerun sequentially after their cleanup. No validation rule was weakened.
The 27-phase rehearsal used report image `594be56`; the subsequent worker listener
correction was exercised separately through the real local launcher. Its committed
image `29c7ffb` also built and compiled all five entrypoints. The first frozen-install
image attempt failed extracting the unchanged `effect` tarball; the unchanged retry
passed. Exact-SHA CI repeats the complete packaging/runtime job before final acceptance.

## Parked hosted work

B0.6E stopped **before database access**, with identity/reset-credential gates
unfinished. A hosted rehearsal child was created and retained; the existing private
operator record is needed for future authorized inspection/cleanup. This task did not
resume it or access Neon, EC2/AWS, Nginx, Vercel, OAuth settings, DNS or production secrets.

Last historical hosted observation: legacy SHA `6b465c6`, Neon PostgreSQL 18.6,
migrations 1–8 only; 28 `test-user` designs and 331 deployments (223 completed,
8 failed, 4 live, 96 torn-down), with 348 completed outbox rows. Three simulations
advanced; the fourth was unknown. Public API/WS had maintenance 503 containment,
while legacy writers remained running. These are historical facts, not a fresh census.
Future recovery must re-establish writer fencing, database/restore truth, direct
session-preserving worker connectivity and real same-site OAuth/TLS before cutover.
The existing release kit and its limits remain documented; production work needs
fresh authorization after local V1 quality improves.

## Evidence, cleanup and next milestone

Sanitized local smoke/check/build/audit evidence lives outside Git in OS temporary
storage (`infraforge-local-product-80227d683c124918` and owned integration run records).
Failed attempts are distinct. The disposable smoke database, fixture users/sessions,
temporary visual server/tabs, ten scratch files and all integration containers,
volumes/networks were removed. Cleanup removed eleven verified fixture jobs and
55 matching Redis events, preserving unrelated state and initialized queue metadata.
The second marked listener-smoke database and occupied-port fixture were also removed.
Developer containers are stopped for reuse; their volume, network and generated
local configuration remain intentionally. Unknown Docker resources/caches and
owner files were preserved. Verified unused local test images were removed after
verification. No agent memory folder or permanent scratch archive was added.

Next local milestone: **Reliable Run Outcomes**. Retain timestamped final snapshots
and durable control/chaos application outcomes, then use those facts for useful run
comparison with matching workload/seed. Current gaps include final-state certainty,
control history, causal explanations, run comparison, deletion removing a design's
history, current design names rather than captured run titles, beginner/narrow-screen
UX and the existing bundle size. Do not schedule hosted cutover work during this phase.
