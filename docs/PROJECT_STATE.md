# InfraForge project state

Verified locally 2026-10-15 on `develop`. **Guided evidence reading and deliberate
one-change improvements** extends the accepted credentials and experiment evidence.
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

Research is independent: the Lead specifies what to investigate; the executor
chooses where and how. Use progressive validation: smallest relevant tests while
coding, affected/security suites after a slice, then full validation at the final
checkpoint. Schema/runtime changes also require the release rehearsal. Never
create executor memories or permanent scratch archives.

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
engine/runtime/cost. Prisma 7.9.1 has seventeen migrations; migrations 1–16 are
unchanged. Migration 17 is `20261018000000_challenge_learning`. Simulation model remains
`1`, catalog `2026-08`; engine source, RNG consumption and all 30 goldens are unchanged.

Better Auth 1.7.7 uses native credentials/username support, database sessions, exact HTTP/WS ownership and permitted
Origins. Cookies are host-only, HttpOnly, SameSite=Lax and Secure on HTTPS. WS checks
expiry, revocation and run ownership before subscription/delivery. Ownerless legacy
history stays quarantined. Username/email/password works without OAuth configuration;
the bounded server identifier adapter delegates to the original auth handlers.
Usernames are immutable normalized lowercase ASCII (3–30 characters, starting
with a letter; letters/digits/underscores), unique and format-checked in PostgreSQL.
Old users keep NULL usernames. New emails are trimmed/lowercased, with an additional
case-fold unique index; ambiguous legacy collisions abort migration, never merge
accounts. Passwords use native salted scrypt, 15–128 library string-length bounds,
no composition rules, and bounded credential bodies. Credential email remains
truthfully unverified; no delivery/reset flow or automatic linking is added.
Session UI exposes username and email verification without internal account/password data.
Dry-run-first ownership recovery needs independent
evidence, a verified design owner and inactive unassigned linked runs; detached
ownerless runs remain quarantined. Google/GitHub OAuth still requires owner
credentials and end-to-end verification. No fixture-login endpoint is public.

Manual path: `bun run dev:setup`, `bun run dev`, open
`http://localhost:5173/signup`, create an account, then sign out and return through
`/signin` with either identifier. Future auth methods are **email OTP/magic link**
and **phone number**, not implemented. They require real delivery and a reviewed
identity/linking/revocation policy using the existing user/ownership model.

Accepted credential checkpoint: `6d455be28994043251eed11bb3abe92ed1e97db7`,
[exact-SHA CI 38689363016](https://github.com/binaryrishabh/InfraForge/actions/runs/38689363016),
10/10 jobs green. Credential behavior remains accepted and unchanged in this milestone.

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

## Guided reading and deliberate improvements

The report remains the canonical record. Its short guided layer recalls the
learner's prediction/reasoning, selects a few recorded facts, states limits and
asks for the learner's own next hypothesis. Server-derived deterministic cues reuse
the existing evaluator: failed requirements first (up to two), one prediction
mismatch, selected exact terminal evidence or two actual fault-boundary samples,
and an explicit unknown. Each fact carries its source and interpretation limit.
Missing definitions/evidence produce unknowns, never reconstructed measurements,
causal advice, hidden reference designs or automatic fixes. Full debrief/trace and
Observed / Interpreted / Unknown remain available. Resource links move keyboard
focus to the recorded measurement, with a return to the guided section.

Plan one change creates a separate owned workspace from the source attempt's
immutable starting input, even when its old saved design is gone. It preserves
existing designs and confirms unsaved-canvas replacement. A bounded 400-character
learner-authored hypothesis/source context accompanies editing; the browser-history
draft is checked against owner/design and is not a cross-device journal. Home does
not invent an unfinished-workflow task. On creation, migration 17 durably captures
the source FK, hypothesis and improvement/repeat intent with the new deployment.
SQL enforces an inactive same-owner source, matching challenge conditions and
immutable provenance; append-only links cannot form cycles. Source deletion nulls
the FK while preserving the child's hypothesis and evidence.

Before a new prediction, the server reuses Honest Compare's canonical input/design
diff to count config-field, resource and connection edits, including model-1 relative
ordering changes. Membership changes are not counted twice as order edits. Names
and canvas positions remain visual only. One change proceeds normally; multiple
changes require acknowledgement; no change requires an explicit repeat. A reviewed
input hash rejects stale saved designs. Neither case changes the challenge into a
freeform rerun: id/version/spec hash, workload, seed, experiment and evaluation
remain fixed, with a fresh prediction inserted before work can start. Late browser
responses cannot replace another account/design or newer canvas edits.

Finished attempts offer an explicit source comparison. History and source reports
show direct learning relationships; no previous attempt is guessed by array order.
Compare keeps its existing evidence/conduct classifier and adds the same factual
change summary/hypothesis. One fact plus matching exact conditions/evidence can make
the pair easier to interpret; it does not eliminate RNG alignment, interaction,
single-pair or educational-model limits. All nine published challenge definitions
and engine model 1 remain unchanged. Designer still requires 1100 CSS px.

Research informed the scaffold: [CMU targeted practice/reflection](https://www.cmu.edu/teaching/principles/learning.html),
[IES explanatory prompts](https://ies.ed.gov/ncee/wwc/PracticeGuide/1),
[Google SRE hypothesis testing](https://sre.google/sre-book/effective-troubleshooting/)
and [NIST's one-factor interaction limits](https://www.itl.nist.gov/div898/handbook/pri/section2/pri212.htm).
These are design principles, not a claim that this UI's learning effectiveness was experimentally established.

## Web interface

One design system replaces the previous UI: Paper and Ink themes, comfortable/compact
density and reduced motion as CSS tokens; Atkinson Hyperlegible Next/Mono and
Newsreader (OFL-1.1); small primitives in `apps/web/src/ui`; health and status always
pair a glyph with a word. Routes: landing, sign-in, `/home` (next step), `/challenges`
and briefs, `/designs`, `/runs` with kind filter, `/runs/:id` (Observed / Interpreted /
Unknown, debrief first), `/runs/compare` (no winner), `/settings` and `/design`.
`/dashboard` and `/reports/*` redirect. The designer has one workspace bar, palette and
rail, a keyboard-complete canvas and brief/inspector/checks panel. Architecture
editing/live spatial work is desktop-class: minimum **1100 CSS px**, comprising a
256px palette, 340px details and 504px drafting area (two 208px cards, 40px gap,
48px margins). Below that width an original accessible larger-workspace page
replaces the canvas; no separate mobile geometry/palette/inspector is introduced.
The heavy workspace is lazy and not mounted on unsupported screens. Resizing
retains unsaved design state and run-bound last-observed telemetry; new runs and
account/session reset clear telemetry, and prior-run/other-account frames are
rejected. This is a browser cache, not simulator checkpoint recovery. At 375px,
Designer QA verifies the fallback. Other product pages remain responsive.
Live runs always use Ink; attempts show only speed and stop and say why; freeform runs
keep load, fault, resize, pool and live edits. Designer, report and compare load on
demand (main chunk about 254 kB). Resilience attempts add an experiment timeline (keyboard
and screen-reader readable, announced once per phase), text states such as "Crash on
app-2 active · 14 simulated seconds remaining" and "Fault ended at second 90", the
target marked on its card and a static failed tone on edges into failed resources;
no edge metrics are invented and reduced motion removes the fault outline animation.

## Verification, failures and cleanup

Started clean at `6d455be28994043251eed11bb3abe92ed1e97db7`. The backend was
verified in the normal-context, commit-tagged `ce23f9d` image. Owner identity/history,
migrations 1–16, lockfile, all nine challenge definitions/hashes, engine source and
goldens are preserved. Unique logs/JSON/screenshots stay outside Git in the OS
temporary directory `infraforge-guided-evidence-20261015`; accepted credential and
earlier experiment evidence remains separately retained. No agent folders or
executor memories were created.

| Check | Actual result |
| --- | --- |
| Frozen install | Passed on Linux Bun 1.3.14; lockfile unchanged |
| Typecheck | All Linux workspace tasks and release compiler passed; native Windows Prisma process exited 9, so Linux is the full validation evidence |
| Lint/boundaries | All lint tasks; 2,308 imports, no file/workspace cycles or runtime leaks |
| Workspace tests | 273 passed: catalog 9, domain 15, simulation 32, web 78, backend 139; 12 DB cases skipped here and exercised with disposable databases |
| Engine | All 30 unchanged goldens plus jitter/connection-order regressions passed |
| Challenges | 56 passed, 502 assertions; all nine published definitions/hashes unchanged |
| Tooling | 23 passed, 279 assertions |
| Focused learning | 148 real-session integration assertions: source inputs after design deletion, owner isolation/no mutation, fixed conditions, fresh prediction, stale hash, multi-change acknowledgement, repeat intent, lineage and immutable SQL guards |
| PostgreSQL 18/Redis | Exact backend image: 18 passed, 1,419 assertions across twelve files; lifecycle/retries/teardown/reruns/traces/history/security/migrations and cleanup passed |
| Migration 17 | Populated schema-16 upgrade: 11 assertions; legacy fields stay NULL, source/conditions/completeness and immutability guards, source deletion and release guard drift checks passed |
| Docker/release | Normal-context commit-tagged backend image built. Because migration 17 is new, publication closure requires final exact-SHA CI packaging and the full Linux release rehearsal; the accepted credential checkpoint's rehearsal is not evidence for this migration |
| Frontend build | Passed; production main chunk 254.02 kB, no chunk warning |
| Dependency audit | `{}`; no dependency upgrade |

Step-by-step local Chromium UI QA used public credential signup with no OAuth or
fixture login. A failed Design attempt led to one encryption edit, a fresh
prediction, another challenge attempt and explicit source comparison: scan findings
changed from five to four. A failed CPU-pressure attempt led through its actual
51-sample trace to one app-2 size edit and another fresh prediction/run/compare:
CPU at second 61 changed from 93.3% to 69.3%. These are observations of the tested
pair, not general causal conclusions. Both pairs retained identical challenge
conditions and matched comparison evidence. No-change repeat and multi-change
acknowledgement, source/child history, resource focus/return, 375px report/compare
and 1099/1100/1101px Designer boundaries passed. Unsaved edits survived resizing;
no browser page errors were recorded. The desktop browser controller was unavailable,
so this evidence is from local headless Chromium, not native Windows manual browsing.
Existing credential sign-in/isolation and telemetry reattachment behavior remains
accepted at the checkpoint above and covered by the full regression suite.

Validation found and removed two new type-import cycles rather than suppressing
boundary checks. The earlier credential-migration regression now pins schema 16
explicitly, preserving its historical upgrade proof after migration 17. No auth,
engine, challenge definition or dependency change was required. OAuth callbacks
remain unverified without credentials. Local/CI verification is not production proof.

Both managed integration runs reported no cleanup errors. After browser evidence
capture, all five owned QA containers and three unused task image tags were removed;
no QA volumes or networks were created. Six disposable source/helper/configuration
files were removed (2,429,136 bytes). Unique logs/screenshots, unknown resources and
developer storage were preserved; no task-owned QA containers remain.

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
QA now uses real public credentials in disposable local data. The sample design keeps the two readiness
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

Improvement drafts are browser-history context, not durable unfinished tasks; a
new attempt durably retains its hypothesis. Deleting its source removes the ability
to compare with that source but preserves the child's own evidence/hypothesis.

Next product milestone: an explicitly authored and calibrated post-fault recovery
exercise with its own observation window. Recovery must not be inferred from fault
completion. Hosted production remains parked.
