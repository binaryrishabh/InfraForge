# InfraForge project state

Verified locally 2026-10-14 on `develop`. **Bounded experiment evidence over time**
extends immutable challenge versions, resilience experiments and Honest Rerun + Compare.
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
engine/runtime/cost. Prisma 7.9.1 has fifteen migrations; migrations 1–14 are
unchanged. Migration 15 is `20261016000000_experiment_evidence`. Simulation model remains
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

Nine challenges live in `apps/backend/challenges`: six Design challenges (two
starter, two core, two advanced) and three Resilience challenges, calibrated against
model 1/catalog 2026-08. A learner opens a per-challenge workspace (a saved design
marked with its challenge and version), designs, answers fixed prediction questions and
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

**Immutable versions.** Each published version is its own file
(`definitions/<id>/v<N>.ts`); identity is challenge id + version + spec hash (sha256 of
every authored field). The registry offers `findChallenge(id, version)`,
`latestChallenge(id)` and `listLatestChallenges()`. Lists, briefs and new attempts use
the latest version; evaluation resolves the attempt's exact version and confirms its
hash and recorded experiment plan, and a missing version or different hash/plan is
reported as not evaluable instead of being re-judged. Any change to a published
version, a typo fix included, ships as the next version; tests pin every published
hash and fail if one changes or disappears (rules in `apps/backend/challenges/README.md`).
Workspaces record `challengeVersion` (migration 14, existing workspaces backfilled to
1); an older workspace never becomes the new version silently: the brief offers a fresh
workspace or an explicit copy, and attempts refuse a workspace of another version.
There is no CMS: `bun run check:challenges` validates schema, ids/versions, hashes,
bounded text, timings, starter graph, allowed types, workload, fault plan,
starter-fails/reference-passes calibration and that references are not shipped.

**Resilience experiments.** A Resilience challenge adds one bounded experiment: one
supported fault (Crash or CPU spike) at an authored simulated second on an explicit starter
resource id and type. The server checks that the target exists, is reachable from an
entry point and, for a server, sits behind a pooled load balancer; otherwise preflight
and attempt creation explain why, and nothing is substituted. The plan is stored with
the run. The worker stops tick batches at the fault second at 1×/10×/60×, records one
durable chaos `RunAction` with `trigger: challenge-experiment` (SQL accepts one per
run, only when it matches the stored plan; client requests cannot carry a trigger) and applies it in the same cycle after earlier
completions. Its outcome keeps overall health just before the fault. A failed write
freezes the run at that second without reapplying; restart fails interrupted work.
Attempts are judged on the last active fault second (start + model duration), and a
stop before the fault is established is not evaluated. Predictions are split into
before-fault (baseline health) and while-active questions, judged from the retained
action outcome and terminal capture. Initial pack: Lose an app server (crash `app-2`
at 60 s) and Cache failure (crash the cache at 60 s). The debrief adds the experiment,
its retained evidence, what it cannot show (gaps, outside the window; fault end is not recovery) and
how to improve; compare states whether two attempts ran identical challenge conditions.
Freeform manual chaos is unchanged.

## Bounded experiment evidence

Only resilience attempts retain completed-tick measurements. The fixed window is
`max(0, faultSecond - 30)` through evaluation, inclusive, with at most 121 points,
128 resources (including possible autoscaled replicas), 128 pool summaries and
65,536 serialized payload bytes per sample. Authoring and attempt readiness refuse
unsupported windows/designs. Capture keeps simulated second, actual measurement time,
topology revision, overall health/load, resource health/CPU/memory and available
RPS/connections, plus current/base replicas and pending provisioning/draining. Current
replicas include placed crashed servers; the count does not establish serving health.
No logs, topology copies, edge throughput, latency or error rates are sampled.

`RunEvidenceSample` has a run/second primary key and run FK with cascade on run
deletion. Inactive design deletion preserves the run and samples. SQL guards bound
the window, payload, timestamps and identities and prevent updates. Run ownership
scopes reports; ownerless legacy history remains quarantined. The additive migration
also indexes bounded per-challenge latest-attempt queries and preserves existing rows.

Ticks capture small points in memory; batches persist before another batch, fault
application or terminal capture. A failed transaction/reply freezes advancement and
retries the original captures. Canonical payload hashes accept identical retries
without overwriting the first timestamp and reject conflicting seconds atomically.
Capture-contract failure also freezes. Restart retains durable partial evidence and
fails interrupted work; there is no checkpoint resume. Tick 60 measures the state
before the scheduled fault applies at 60; tick 61 can first measure its effect.

RunReport derives complete/incomplete/unavailable/not-applicable, expected/actual
bounds, missing ranges and bounded key facts on the server. Old runs have no invented
series. Normal Design/freeform runs retain no trace. Debriefs show a discrete health
track and CPU/memory for one selected resource, applied/evaluation markers, gaps,
key-moment table and keyboard-selectable individual seconds with equivalent text.
Straight lines join adjacent retained seconds only; there is no interpolation,
smoothing or value animation. Live WebSocket snapshots do not become a per-second
chart. Existing Compare adds completeness and retained-window target peaks without
another classifier, curve overlays, rankings or statistical claims.

Research principles: bounded context and action annotations ([AWS FIS](https://docs.aws.amazon.com/fis/latest/userguide/experiment-report-configuration.html)),
fault timing distinct from resource monitoring ([Azure Chaos Studio](https://learn.microsoft.com/en-us/azure/chaos-studio/chaos-studio-set-up-azure-monitor)),
experiment-relevant health observations ([Gremlin](https://www.gremlin.com/docs/platform-health-checks))
and explicitly timed measurements/gaps ([OpenTelemetry](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)). No external telemetry infrastructure was added.

**Headroom under CPU pressure@1** adds the single new fault challenge: 143 RPS,
app-2 CPU spike at 60 for 20 seconds, evaluation at 80. Real-engine calibration
compared CPU spike, memory leak, disk full and network delay. The published starter
fails; a hidden reference sizing app-2 to c5.xlarge passes, with all predictions
matched. Starter app-2 records 48.2% CPU at 60, 93.3% at 61 and 90.9% at 80;
reference records 24.1%, 69.3% and 67.6%. Scaling remains pending at evaluation.
The eight previously published definitions/hashes and engine model 1 are unchanged.

**Recent learning** uses owner-scoped cursor pagination (maximum 50 rows), raw
requirement/prediction counts, version/fault, report and Improve links. One indexed
query per challenge selects its latest 20 attempts, so activity in another challenge
cannot evict its latest attempt. The Met indicator explicitly means met in this
recent window. Unknown/future versions remain unavailable and cannot silently retry
as another version. Freeform reruns stay outside learning history. Reopening an
already loaded workspace refreshes server-owned challenge identity after a freeform
rerun without replacing unsaved canvas edits; late responses cannot relabel another
account, design or live run.

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
demand (main chunk 251 kB). Resilience attempts add an experiment timeline (keyboard
and screen-reader readable, announced once per phase), text states such as "Crash on
app-2 active · 14 simulated seconds remaining" and "Fault ended at second 90", the
target marked on its card and a static failed tone on edges into failed resources;
no edge metrics are invented and reduced motion removes the fault outline animation.

## Verification, failures and cleanup

Started from `b397da0`. Evidence logs, integration JSON and browser screenshots stay
in the OS temporary evidence directory outside Git; no agent memory or scratch archive
was added.

| Check | Actual result |
| --- | --- |
| Frozen install | 498 installs across 548 packages; lockfile unchanged |
| Typecheck | Seven workspace tasks and release compiler passed, including the navigation correction |
| Lint/boundaries | Five ESLint tasks; 2,152 imports, no cycles/runtime leaks |
| Workspace tests | 255 passed: catalog 9, domain 15, simulation 32, web 65, backend 134; 10 DB cases run below |
| Engine | All 30 goldens plus jitter/connection-order regressions passed; engine and goldens unchanged |
| `check:challenges` | 56 passed across six files, including immutable hashes, all nine calibrated challenges, four-fault research, trace ordering and exact 1×/10×/60× scheduling |
| Tooling | 23 passed, 279 assertions |
| PostgreSQL 18/Redis | 16 passed, 1,253 assertions across ten files; real sessions/ownership, all migration proofs, 1×/10×/60× traces, frozen writes, terminal retry, restart prefixes, gaps and 302-record mixed-version history; no harness cleanup errors |
| Docker | Normal-context code image built; Compose fixture and all five packaged entrypoints passed |
| Release rehearsal | All 27 stages passed on the backend code image: migration/postchecks, real sessions, worker replacement, pooling, TLS/Origin, dependency loss and compatible rollback; owned rehearsal resources removed |
| Frontend build | Passed without chunk warning; main chunk 251 kB |
| Dependency audit | `{}` |

Validation exposed and repaired an import cycle, fixture typing and a real new-migration
SQL operator-precedence error that rejected samples containing pool summaries. A real
PostgreSQL pending-pool regression now exercises that path. The initial full integration
suite stalled at its first 1× trace; the corrected full suite above passed. Docker image
installation initially failed extracting TypeScript, then succeeded unchanged on retry.
Windows paging pressure subsequently stopped Docker and interrupted source copies in
owned containers. The owner recovered Docker; copied sources are refreshed and checked,
and final validation runs sequentially. No machine settings or unrelated apps changed.

Authenticated browser QA used the actual SPA/API/WS/worker with disposable PostgreSQL
18/Redis 8 and real Better Auth adapter sessions. Lose an app server at 10× and Cache
failure at 60× retained 61 samples (30–90); early stop at 70 retained 41 samples and
remained not evaluated; CPU starter/reference at 60× retained 51 samples (30–80) and
failed/passed respectively, with every prediction matched. Fault markers and values at
59/60/61/evaluation agree with server evidence. A deliberate fixture gap at 42–43 breaks
both pressure paths and is labelled incomplete. Resource/second keyboard selectors,
focus outlines, table/text equivalents, Compare with complete/absent traces and a real
freeform Run again (matched stop 80, no fault/trace) were exercised. Improve exposed the
same-workspace identity defect described above; the repaired browser flow completed a new CPU attempt at 1× with 51 exact samples, all predictions matched and the same calibrated result.
Paper trace layouts passed at 375/768/1280/1920 px without horizontal page overflow;
Ink trace/gap and live-rerun layouts passed at narrow/wide sizes. Trace nodes have no
animations/transitions; reduced-motion CSS tests pass, but this browser cannot emulate
an OS reduced-motion setting. OAuth provider sign-in was not claimed from fixture login.

Owned fixtures are removed after their proofs complete; only unique evidence is retained.
Earlier ownership, session, run-input, action, exact teardown, rerun and migration proofs
remain in the full integration suite. Local and CI verification is not production proof.
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
Every challenge is still at version 1, so the upgrade path (older-workspace notice,
fresh or copied workspace) is proven by registry fixtures, server-rendered tests and
SQL guards, not by a real second version in the browser. Experiments retain one fault
and a bounded tick window, not continuous monitoring. Evidence before the window,
missing points and actual recovery remain unknown. Published evaluation stops occur
on the last active fault tick, so these traces cannot establish post-fault recovery.
Restart fails interrupted work; it never resumes a checkpoint. Recent Met indicators
cover the latest 20 attempts rather than an invented lifetime achievement. Local/CI
proof is not production readiness.

Next product milestone: guided evidence reading and deliberate single-change
improvements. Any recovery challenge needs an explicitly authored and calibrated
post-fault observation window; recovery must not be inferred from fault completion.
Hosted production remains parked.
