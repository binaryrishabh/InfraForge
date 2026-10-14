# InfraForge project state

Verified locally 2026-10-14 on `develop`. **Challenge + Predict and the rebuilt web
interface are implemented**, on top of Reliable Run Evidence and Honest Rerun + Compare.
Hosted production cutover remains **PARKED**. These milestones did not access Neon,
EC2/AWS, hosted PostgreSQL/Nginx, Vercel, DNS, OAuth settings, production secrets or
`main`.

See [local setup](../Readme.md), [authentication](AUTHENTICATION.md),
[integration tests](../apps/backend/tests/integration/README.md) and the existing
[release procedure](DEPLOYMENT.md). This is the main project state; keep evidence
outside Git and do not create executor memories or planning archives.

## Product direction and policy

Complete **Challenge → Build → Predict → Run → Break → Understand → Improve →
Run again** before expanding scope. Preserve the visual identity and use progressive
disclosure. **Observed / Interpreted / Unknown is permanent.** Interpretations need
retained deterministic evidence. Results describe an educational model, not cloud
bills, production sizing, recovery guarantees or statistical proof.

Keep modules small, boundaries explicit, migrations additive and published history
intact. One mutating executor uses the owner Git identity. Approved model policy:
GPT-6.1 Sol, Extra High; INNER NONE. External review needs scoped owner authorization.
Develop work cannot promote/deploy main or operate on production data.

## Accepted architecture and foundation

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | React 19/Vite/Zustand: challenges, designer, live runs, runs, reports and compare |
| `apps/backend` | Express, Prisma/PostgreSQL, outbox/BullMQ, worker, WS and report derivation |
| `packages/domain` | Resource/workload types, graph/readiness rules and examples |
| `packages/catalog` | Provider SKU data and lookup |
| `packages/contracts` | Inputs, deployment, actions, telemetry and report DTOs |
| `packages/simulation` | Deterministic engine, runtime, cost, capacity and tuning |

Bun 1.3.14/Turbo 2.11.6 own one root install/lockfile. Browser imports cannot reach
engine/runtime/cost. Prisma 7.9.1 has thirteen migrations; the first twelve are
unchanged. Migration 13 is `20261014000000_challenge_attempts`. Simulation model remains
`1`, catalog `2026-08`; engine source, RNG consumption and all 30 goldens are unchanged.

Better Auth 1.7.7 uses database sessions, exact HTTP/WS ownership and permitted
Origins. Cookies are host-only, HttpOnly, SameSite=Lax and Secure on HTTPS. WS checks
expiry, revocation and run ownership before subscription/delivery. Ownerless legacy
history stays quarantined. Dry-run-first ownership recovery needs independent
evidence, a verified design owner and inactive unassigned linked runs; detached
ownerless runs remain quarantined. Google/GitHub OAuth still requires owner
credentials and end-to-end verification. No fixture-login endpoint is public.

`bun run dev:setup` prepares labelled PostgreSQL 18/Redis 8 resources. `bun run dev`
migrates/generates and supervises API, worker, WS and frontend with generated local
configuration, ignoring app dotenv/hosted settings. Database/Redis ports 55432/56379
and application ports 3000/3001/3002/5173 bind to loopback. Unknown resource/port
collisions are refused. Accepted listener/four-process smokes preserve developer
storage. Worker ownership requires a session-preserving PostgreSQL connection;
restart explicitly fails interrupted runs/actions rather than resuming checkpoints.

## Reliable inputs, controls and evidence

Creation captures validated topology, fully resolved workload, seed and V2
model/catalog provenance. Gates, initialization and retries use those immutable
inputs. V1 remains readable without invented metadata; incompatible V2 execution
is refused. Saved design, original input and revisioned accepted/applied live
topology stay separate. Duplicate initialization/jobs cannot replace inputs.

Runs own nullable `ownerId` and captured `runName`. Verified linked ownership/name
was backfilled without assigning ownerless history. Backfilled legacy names are
not claimed as original names. SQL/HTTP block design deletion while runs are active;
inactive design deletion uses SET NULL and preserves run/report/action ownership.

`RunAction` durably records load, speed, chaos, vertical/pool scale, topology and
teardown. Owner/live/target/SKU/pool/revision checks precede insertion. A row lock
allocates unique per-run sequence. The worker polls PostgreSQL each second, even
while paused; Redis notifications are optional. Lifecycle is requested → applying
→ running/completed, or failed/cancelled. Failed acknowledgements freeze the exact
memory state and retry its write without reapplying effects. SQL protects request
identity and closed outcomes. Reports bound action disclosure to 500 with omissions
labelled; earlier records remain stored.

Outcomes retain actual application/completion times, values, installed SKU/online
state, replica transition and accepted/applied topology revisions. Fault end is
not system recovery. Legacy chaos requests remain request-only. Exact teardown
captures state once, then atomically commits terminal evidence, action completion,
unfinished-action cancellation and runtime retirement before removing memory.
Failed writes freeze/retry the same capture. Offline teardown stays requested;
restart fails interrupted work explicitly. No replay or checkpoint recovery exists.

Terminal evidence includes simulated seconds, costs, load, health, measurements,
topology revision, installed SKUs, pools, faults/restarts and measurement time/revision.
Exact state may contain initialized or older measurements; freshness is labelled.
Diagnostic checkpoints retain actual capture time when available; `updatedAt` never
stands in for measurement time. Timestamp-less legacy checkpoints remain unknown.

## Honest Rerun + Compare

One backend classifier separates starting inputs, durable action conduct and
exact-terminal/checkpoint/missing evidence; React renders its source-backed facts.
Grades are **same starting point**, **one design change**, **one workload change**,
**same setup/different seed**, **several changes**, or **side-by-side only**. Missing
or different input/model/catalog provenance and ambiguous topology allow descriptive
comparison only. Conduct compares actual simulated application/completion and
outcomes; malformed, truncated or uncertain effects cannot establish equality.
Speed is displayed separately: it does not change tick math by itself but can change
when later human actions land in simulated time.

Final deltas require two exact terminal captures. Accumulated-cost delta additionally
requires equal simulated duration; gate monthly estimates require compatible catalog
provenance. Hourly burn, accumulated cost and monthly estimate stay distinct. Units
and later-minus-earlier signs imply no winner. Same-start/no-affecting-action/equal-stop
model-1 pairs compare normalized deterministic state and surface mismatches explicitly.

Model 1 reseeds each simulated second and consumes jitter in resource iteration
order. Shared starting resources at equal captured positions have aligned draws;
appending preserves them, while insertion/removal/reordering shifts displaced
resources. Alignment does not imply identical measurements or controlled causality.
Dynamic resources/future models are ungraded; non-preserved numeric object-key order
is unknown. An engine regression isolates jitter from traffic distribution.
Connection order is also retained as a starting-design and topology-action difference.
Model 1 builds ordered adjacency and uses the first pool VM as its autoscaling
template; reversing connections can change spawned identity/SKU even with aligned
starting jitter. A direct engine regression proves this without changing the model.

Exact rerun copies supported V2 input in the current model/catalog, even after design
deletion. Current-design rerun requires the original owned design and captures its
current topology with source workload/seed and current provenance. Neither replays
original actions. Server preview/hash verification refuses a changed design before
creation. Migration 12 adds immutable source/mode/stop target and a bounded one-hop
family, verifies inactive same-owner sources and permits owned designless creation
only for verified identical-input exact reruns. Legacy records stay untouched; source
deletion clears its FK without deleting child evidence. No family graph table exists.

Matched stop defaults on for exact source duration 1–604,800 seconds. The worker
checks every simulated tick, records action completions first and never overshoots
inside 1×/10×/60× batches. At the target it captures once, creates an audited
`trigger: matched-stop` teardown and uses the existing terminal transaction. An earlier
user stop remains valid; later requests cannot relabel a frozen capture or occupy
the unique open-teardown slot. Failed action/terminal writes retain the original
capture while frozen. Retry also emits terminal notifications; HTTP terminal polling
supports the UI when Redis delivery is unavailable.

History selects exactly two eligible runs; report picker prioritizes related runs,
then the surviving design, then other owned history. Reports show source/direct
reruns and offer Run again/Open design to improve. Live context shows source, mode
and stop countdown; finished runs retain comparison/report links until deliberate
return to Designer. Improve previews the actual unsaved canvas, explicitly saves
that canvas first and then verifies its hash before capturing the rerun. Source
workload/seed are fixed. Changed context/preview or account is refused. Keyboard
selection, native disclosures, real table headers/captions, focus return, readable
portal text, reduced motion and narrow metric blocks preserve the existing design.

## Challenge + Predict

Six versioned challenges (two starter, two core, two advanced) live in
`apps/backend/challenges`, calibrated against model 1/catalog 2026-08 and pinned by
version-1 spec hashes in tests. A learner opens a per-challenge workspace (a saved
design marked with its challenge), designs, answers fixed prediction questions and
starts an attempt. The prediction is written in the same insert as the run and is
immutable. Migration 13 adds the workspace link, a separate evaluation-stop column,
completeness/immutability guards and an insert guard that accepts only speed and stop
actions during an attempt. The worker stops exactly at the evaluation second
(`trigger: challenge-evaluation`). Criteria and prediction outcomes are derived from
recorded evidence on every read and are reported as two separate verdicts; early
stops or other rule versions are not re-judged. The debrief explanation is withheld
by the server until a first attempt. Passing reference designs exist only as backend
test fixtures (`tests/challengeHarness.ts`); the image, API and web bundle carry only
starters. Reruns of attempts are freeform.

## Web interface

One design system replaces the previous UI: Paper and Ink themes, comfortable/compact
density and reduced motion as CSS tokens; Atkinson Hyperlegible Next/Mono and
Newsreader (OFL-1.1); small primitives in `apps/web/src/ui`; health and status always
pair a glyph with a word. Routes: landing, sign-in, `/home` (next step), `/challenges`
and briefs, `/designs`, `/runs` with kind filter, `/runs/:id` (Observed / Interpreted /
Unknown, debrief first), `/runs/compare` (no winner), `/settings` and `/design`.
`/dashboard` and `/reports/*` redirect. The designer has one workspace bar, palette and
rail, a keyboard-complete canvas, brief/inspector/checks panel and sheets below 768 px.
Live runs always use Ink; attempts show only speed and stop and say why; freeform runs
keep load, fault, resize, pool and live edits. Designer, report and compare load on
demand (main chunk 242 kB).

## Verification, failures and cleanup

Code SHA `2eb7c5f` was validated exactly (`git archive HEAD` in Linux, CI commands):

| Check | Actual result |
| --- | --- |
| Frozen install | 491 packages; lockfile unchanged |
| Typecheck | Seven workspace tasks and release compiler passed |
| Lint/boundaries | Five ESLint tasks; 1,835 imports, no cycles/runtime leaks |
| Workspace tests | 206 passed: catalog 9, domain 15, simulation 32, web 52, backend 98 (8 DB cases run below) |
| Engine | All 30 goldens plus jitter/connection-order regressions passed; engine and goldens unchanged |
| Challenges | 24 tests: reference designs meet, starters fail, verdicts separate, hashes pinned |
| Tooling | 23 passed |
| PostgreSQL 18/Redis integration | 14 passed, 1,161 assertions across eight files on the commit image; no cleanup errors |
| Docker | Normal-context image built, Compose fixture config passed, five entrypoints compiled |
| Release rehearsal | All 27 stages passed on the commit image (migration, rollback, isolation, fail-closed); own resources removed |
| Frontend build | Passed without chunk warning; main chunk 242 kB |
| Dependency audit | `{}` |

Authenticated browser QA ran the real SPA against a disposable local stack (API, WS,
worker, PostgreSQL 18, Redis 8 in labelled containers) with a fixture session created
through Better Auth's adapter on localhost only. It covered landing, sign-in, Home,
all six briefs, designer (palette, rail, keyboard, inspector, connections, undo),
predict dialog, live attempts and freeform runs (load, fault, resize, pool, stop),
debriefs for a failed attempt with a correct prediction and a passed attempt with a
wrong one, runs, reports, compare, reruns, Designs, Settings and not-found. Every route
was swept at 375, 768, 1280 and 1920 px with no horizontal page overflow, mostly in Ink;
the designer and Runs were also checked in Paper. Text tokens measure at least 4.5:1 on
every surface in both themes. QA found and fixed: a draft
overwritten by `/design?design=` on a fresh load, challenge identity lost after a
rerun, stale gate evidence in live runs, focus lost after deletes and dialogs, a
clipped prediction table on phones, select labels that absorbed option text, an
inert density setting, raw status words, a landing illustration that matched a
challenge outcome, and the `.dockerignore` gap that broke image builds.

Earlier milestones' database proofs (ownership, sessions, exact teardown, reruns,
matched stops, migrations) still run in the integration suite above. Windows Bun and
`tsc` remain unreliable on this host (native crashes, out of memory), so final checks
ran in Linux containers. Owned QA containers, network, images, volumes and scratch
were removed; evidence stays outside Git. No agent-memory folder or scratch archive
was added.

## Parked hosted work and remaining limits

B0.6E stopped before database access with identity/reset-credential gates unfinished.
A retained hosted rehearsal child/private operator record needs future authorized
inspection/cleanup. Historical hosted facts: legacy SHA `6b465c6`, Neon PostgreSQL
18.6, migrations 1–8, 28 `test-user` designs, 331 deployments (223 completed, 8 failed,
4 live, 96 torn-down), 348 completed outbox rows; three simulations advanced and the
fourth was unknown. Public API/WS had maintenance containment while legacy writers
remained. This is historical evidence, not a fresh census. Future cutover requires
renewed writer fencing, database/restore truth, session-preserving worker connections
and verified OAuth/TLS configuration.

A single pair establishes no statistical significance, production reliability, real
cloud behavior or general superiority across seeds. Continuous telemetry, all
automatic scaling events, replay/checkpoint recovery and multi-seed experiments
remain absent. Model-2 resource-keyed RNG is deferred to an explicit simulation
milestone. Windows runtime stability (native Bun crashes, `tsc` out of memory on this
host) and external OAuth sign-in in a browser remain unverified; authenticated browser
QA used a local fixture session. The sample design deliberately keeps the two readiness
warnings its domain tests pin (vm-2 has no data path, monitor-1 is unreachable).
Challenges have one version each and no authoring tool. Local/CI proof is not
production readiness.

Next product milestone: **Challenge authoring and versioning**: a reviewed workflow for
a second definition version (recalibration, hash pinning, old attempts kept under their
own rules), a factual cross-challenge attempt history with no scores, and broader
beginner guidance in the designer, while hosted production work stays parked.
