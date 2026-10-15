# InfraForge project state

Verified locally 2026-10-15 on `develop`. **Reality Engine M2F** adds internal messaging,
object storage and asynchronous pipelines; the accepted learning product stays on Model 1.
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

Ten challenges live in `apps/backend/challenges`: six Design challenges (two
starter, two core, two advanced) and four Resilience challenges, calibrated against
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
| Tooling | 24 passed, 289 assertions after the release shutdown correction; release TypeScript compiler also passed |
| Focused learning | 148 real-session integration assertions: source inputs after design deletion, owner isolation/no mutation, fixed conditions, fresh prediction, stale hash, multi-change acknowledgement, repeat intent, lineage and immutable SQL guards |
| PostgreSQL 18/Redis | Exact backend image: 18 passed, 1,419 assertions across twelve files; lifecycle/retries/teardown/reruns/traces/history/security/migrations and cleanup passed |
| Migration 17 | Populated schema-16 upgrade: 11 assertions; legacy fields stay NULL, source/conditions/completeness and immutability guards, source deletion and release guard drift checks passed |
| Docker/release | Exact implementation-SHA image, Compose and five packaged entrypoints passed CI. All 27 full Linux rehearsal stages passed with migration 17: failure/restore/postchecks, worker exclusivity, compatible rollback, unhealthy release, dependency loss, real pooling modes, TLS/session/Origin security and cleanup |
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

The first new exact-SHA CI run (`38700026578`, `80dceff`) passed all eight standard
checks and full integration, but its release rehearsal stopped at the application
shutdown guard after migration/security/worker checks passed. An isolated local
Compose stop/replacement proof did not reproduce it; its services/helpers/network
were removed. Shutdown now inspects all owned application container states, rejects
paused/restarting/unknown states and waits at most five seconds for an engine-state
transition. Failure still prevents migration and reports the blocking state. The
original transition cause was not established; the repeated full rehearsal below
verifies the corrected guard without claiming a reproduced root cause.

Verified implementation checkpoint: `992bc8fb0c51bba848f067db45d9530d0f75d4de`,
[exact-SHA CI 38701069901](https://github.com/binaryrishabh/InfraForge/actions/runs/38701069901),
10/10 jobs green. This includes the complete repeated 27-stage release rehearsal
and all 18 integration tests (1,419 assertions). The shutdown guard passed the full
upgrade/rollback/dependency-loss sequence. Final documentation publication also
requires the normal exact-SHA workflow; these results identify the implementation
checkpoint rather than predicting a later commit's outcome.

## Post-fault observation

New immutable `after-the-cache-returns@1` adds a 45-second observation phase:
baseline → fault active → post-fault observation → evaluation. Crash applies at 60;
tick 90 still measures the fault, then the engine removes it and completes its
durable action. Tick 91 is the first possible post-fault sample. Target Healthy at
91, overall Healthy at 92 and Saturated at evaluation 135 coexist in the starter:
delayed provisioning joins at 126; database connection pressure appears at 127.
The hidden one-change reference passes. No solution is sent in briefs or bundles.

Authoring optionally adds `experiment.postFaultObservationSeconds` (integer 1–60).
Evaluation equals fault start + model duration + observation; the inclusive trace
must fit the unchanged 121-point bound. Omission preserves legacy fault-end judging.
All nine earlier V1 files/hashes, engine/model 1, goldens and migrations 1–17 remain
unchanged. Existing immutable run plan, evaluation stop and samples suffice: **no
migration**. Calibration explored 3,240 deterministic candidates with five faults;
see [authoring/research](../apps/backend/challenges/README.md).

Server-derived observation distinguishes an unverified fault end, no retained
samples, a Healthy sample observed, a complete post-fault window with none Healthy,
and unknown evidence. Target and system stay separate. Facts include actual end,
first retained target state, first Healthy target/system samples, continuity from
expiry through each sample, sample count, evaluation health and pending pool actions.
Missing ticks or subject measurements qualify first Healthy wording as **after
missing evidence**. No duration, interpolation, sustained-health or production-recovery
claim follows. Worker interruption preserves durable samples and fails honestly;
early stop during observation is not evaluated.

Live timeline continues through Observe to later evaluation; active-fault styling
follows actual snapshots. Reports show separate target/system facts, fault-end and
evaluation markers, unsmoothed values, gaps, selected-resource inspection and present
key moments. Guided review follows expectation → fault → after the fault → evaluation
→ unknown → next experiment. Existing hypothesis/fresh prediction/one-change workflow,
source lineage and history are reused. Honest Compare keeps its classifier and fixed
conditions (including horizon), showing first retained Healthy samples and evaluation
states side by side, without a winner or faster-recovery claim. Log presentation
translates engine recovery shorthand into fault-ended or measured-health facts;
engine output and RNG remain unchanged.

Credentials remain accepted. Designer still requires 1100 CSS px; ordinary reports
remain responsive with native keyboard selectors, text/table equivalents, phase
announcements and existing reduced-motion rules. Future auth remains email OTP/magic
link, then phone. Hosted production remains **PARKED**.

Local verification: 156 backend and 83 frontend tests passed; challenge calibration,
all 30 engine goldens, workspace/script type checks, lint/boundaries, frontend build,
tooling and audit passed. The real credential browser loop covered starter at 1×/60×
(all 106 payload hashes identical), guided review, one-change improvement, fresh
prediction, passing rerun, direct Compare, early stop at 120, history, keyboard sample
inspection, 375px report and 1099/1100px Designer boundary. Disposable integration's
full lifecycle including observation/interruption passed; an unrelated transient
NOWAIT conflict in the cutover fixture was isolated, bounded in the test helper and
its two checks passed separately. Exact published-SHA CI remains the final authority.
The local development database had an older malformed evidence-trigger expression;
its function was restored from committed migration 15 without editing migration files.

## Reality Engine M2A

Accepted final M2A checkpoint: `f9e8f1e648f81c20d468637e085deb4c900ce425`,
[CI 38719543934](https://github.com/binaryrishabh/InfraForge/actions/runs/38719543934),
10/10 green.

Accepted post-fault checkpoint: `361a3b1afe33740d8f45d9c79601c6476657d602`,
[CI 38710194176](https://github.com/binaryrishabh/InfraForge/actions/runs/38710194176),
10/10 green. Model 1 remains the sole published active physics for Free Mode and all
ten immutable challenges. No historical inputs/evidence are upgraded or reinterpreted.

**Permanent reality doctrine:** Free Mode numbers must trace to documented provider/
service facts, selected configuration, workload, topology/dependencies, derived models,
researched/calibrated assumptions or explicitly bounded estimates; otherwise **Unknown**.
No arbitrary/decorative numbers or invented precision. Provider capability does not
establish application throughput. Every existing resource needs comparable appropriate
depth; depth precedes new icon families. Shared mechanisms generate consequences;
faults alter resource-specific mechanisms. Free and Challenge modes use the same
physics per version. Independent deep research and progressive validation are permanent.

[Reality research/audit/design](reality/README.md) holds the detailed architecture,
machine-readable numeric ledger and eleven-resource depth matrix. The audit preserves
Model-1 approximations, including catalog gaps, without treating them as future physics.
Model 2 (`"2"`) is internal only: explicit dispatch, unit/provenance/unknown primitives,
stable keyed RNG, integer-time event kernel, modular finite service stations and an
identified-work routing/compute/database proof. Fault pause changes service progress;
held dependency slots and bounded queues propagate pressure. Removal permits state
to drain. Synthetic sensitivity/analytical tests verify mechanics, not real-service
calibration. Memory/cost remain Unknown where unmodeled. No schema/runtime activation,
frontend redesign, provider service or infrastructure addition occurs in M2A.

UI beautification is deferred; Claude later owns the major UI/UX redesign. Credential
auth and the 1100px Designer rule remain accepted. Future auth remains email OTP/magic
link, then phone. Production remains **PARKED**.

## Reality Engine M2B

Accepted final M2B checkpoint: `62b277fc92d8b0630b488539f5bff0996f04b7d5`,
[CI 38733042083](https://github.com/binaryrishabh/InfraForge/actions/runs/38733042083),
10/10 green.

Model 1 remains active, with all historical physics/goldens and ten published
challenge definitions preserved. Model 2 remains internal. `m2b/1` separates
operation classes, open/closed/trace arrivals and versioned service-demand profiles.
Caller deadlines/abandonment do not imply remote cancellation; each service owns an
explicit cancellation capability. Root/attempt/child identity and caller/station
conservation preserve continuing work. Evidence and trace ingestion are bounded.

Profiles require unit/provenance/validity checks; unsupported scenarios stay Unknown.
The measured local PBKDF2 exercise has disjoint fitting/holdout batches and twelve
held-out traces. It proves the calibration pipeline and mix-dependent work pressure,
with visible latency discrepancy; it establishes no cloud SKU or universal RPS.
All profiles remain forbidden from Free Mode. [M2B architecture/research/calibration/
validation](reality/README.md) contains the details and reproducible benchmark data.
No schema, runtime activation, challenge migration, UI redesign or production work.
Production remains **PARKED**.

## Reality Engine M2C

Accepted final M2C checkpoint: `fe642eaf1d3d0b8ea500106394213d7c7bdcf372`,
[CI 38741704584](https://github.com/binaryrishabh/InfraForge/actions/runs/38741704584),
10/10 green.

The internal default is `m2c/1`; explicit M2B and direct M2A replay remain. A dedicated
compute module composes M2B arrivals/caller ownership. Workers bound application
concurrency; capped equal fluid sharing distributes authored CPU capacity among
runnable invocations. Blocking/dependency waits occupy workers without local CPU.
Service pause, cancellation, finite CPU competitors and capacity changes settle
core-time at event boundaries. Optional fixed-period quota has separate throttle
evidence. Observation is pure; utilization uses consumed/integrated available core-time.

Application-specific modeled resident components have process/worker/admitted/active
owners and explicit complete/partial coverage. Detached remote work retains ownership.
Partial totals stay Unknown. Optional allocation rejection requires complete known
components; no reclaim, swap, GC, OOM killer or universal RAM threshold is invented.

The local warm PBKDF2 campaign has 48 batches / 6,144 calls at 1/2/4/8/16/32 workers:
16 fitting and 32 held-out batches, including wholly held-out 2/8-worker configurations.
Eight candidate CPU means apply only at discrete fitting points; unseen-point transfer
is an unsupported diagnostic. Held-out CPU/throughput mean absolute relative errors
are 9.54%/12.74%; capacity/physical scaling and service variance remain unvalidated.
Touched-buffer experiments do not identify universal RSS coefficients; real candidate
resident mapping stays Unknown. Profiles remain forbidden from Free Mode.

[M2C research, architecture, calibration and validation](reality/README.md) record
synthetic A–F/pause proofs, 3,000 generated conservation cases and bounded 10,000-call
performance runs. Model 1/goldens/challenges, schema, UI and runtime activation remain
unchanged. Production PARKED.

## Reality Engine M2D

Accepted M2D SHA: `4847c7b1d4d6ecb15caa214148811d76467db58d`, GitHub Actions
`38749835365`: **10/10 successful**. The separate **Vercel commit status FAILED**.
This checkpoint is not universally green; GitHub metadata was inspected without
accessing the Vercel account/configuration.

The internal default is `m2d/1`; explicit M2C/M2B and direct M2A replay remain. Directed
authored links serialize known request/response bytes through FIFO buffers and separate
propagation; logical paths can share bottlenecks. Resource-neutral pools own connection
establishment, stream leases, reuse, idle expiry, acquisition queues/timeouts and drain.
Serial and configured multiplexed modes do not claim exact TCP/HTTP behavior.

A dedicated LB composes deterministic round robin/least-outstanding, backend pools,
outstanding/pending bounds, readiness, actual operation probes and delayed health
thresholds. Drain stops new selection and closes remaining leases after authored grace.
Caller/acquisition/connect/response/LB-pending/health timeouts remain distinct. Optional
safe retries have new attempts, keyed backoff/jitter and concurrent bounds; they consume
real connections, bytes and compute. Endpoint suspension, link blackholes, added delay,
bandwidth changes and resets act on mechanisms without RPS/CPU multipliers.

The controlled loopback campaign has 90 batches / 2,880 operations: 32 fitting and 58
held-out batches, including 42 wholly held-out configurations. Sixteen conditional
socket-duration points remain internal. The complete networking predictor is rejected:
held-out throughput MARE is 1,488.57%, with timer/runtime costs particularly visible
for tiny messages. No residual latency constant is fitted; physical bandwidth/RTT/
propagation remain Unknown. No WAN/cloud/ALB/NLB validity or Free Mode promotion.

[M2D research/design/calibration/validation](reality/README.md) retain vertical failure,
health lag, reuse/pool/multiplexing/drain/retry/partition proofs, 3,000 generated cases
and bounded 5,000-caller performance runs. Model 1/goldens/challenge hashes, schema, UI
and runtime activation remain unchanged. M2E adds DB/cache depth using these primitives;
transport/runtime accuracy remains unresolved. Production stays **PARKED**.

## Reality Engine M2E

Accepted M2E SHA: `46c76afc1da4220b9a497d34d6ff3db70e647c7d`, Actions
`38757001023`: **10/10 successful**. The separate Vercel deployment status **FAILED**;
its successful Preview Comments check does not change that. The complete M2E timing
predictor remains **REJECTED**. GitHub metadata, not the Vercel account, was inspected.

Explicit internal `m2e/1` composes M2B identity, M2C CPU and M2D transport/pools with
separate relational sessions, bounded transaction admission/programs, statement
snapshots, actual shared/exclusive lock queues, deterministic cycle victims,
commit/rollback/timeouts and authored log acknowledgement. Physical buffer/storage/
fsync/replication/recovery remain Unknown. The old generic DB station is not extended.
Keyed cache entries own sizes, versions, virtual TTL, exact LRU/no-eviction and
warm state. Cache-aside makes real lookup/fetch/fill/invalidation calls; opt-in
coalescing removes duplicate fetches. Faults change service/session/CPU/cache state.

Local labelled disposable PG/Redis fixtures produced 60 DB + 54 cache batches and
were cleaned. The complete timing predictor is **REJECTED** (fit throughput MARE
119.72%, held-out 69.41%); aggregate CPU and runtime/transport/storage residuals do
not identify query timing. All 54 cache hit/miss sequences replay exactly, with
cache timing Unknown. No network backfitting or Free Mode/provider promotion.
The M2D predictor remains rejected at **1,488.57% held-out MARE**.

[M2E research/design/calibration/validation](reality/README.md) retain cascade,
warm-up, TTL, capacity, stampede/coalescing, DB outage, session exhaustion, contention
and detached-work proofs, 3,000 generated cases and 100,000-key executor measurements.
Model 1, its 30 goldens and ten challenge hashes remain unchanged. No UI/schema/
production activation change. Next: messaging/storage mechanisms and deeper
resource-specific recovery, with measurement-layer separation still unresolved.

**Queued defect before hosted/public-preview work resumes:** repeated Vercel commit/
deployment status failures must be diagnosed separately from successful GitHub
Actions. Do not repair Vercel during M2E or call a failing external-status checkpoint
fully green. Production remains **PARKED**.

## Reality Engine M2F

Explicit internal `m2f/1` adds separate `visibility-work-queue/1` and
`atomic-current-object/1` profiles. Queue messages, publish attempts, lease receipts
and processing attempts have distinct identities. Actual ready/scheduled/in-flight
ownership, ACK/NACK, credit, lease redelivery, retention and bounded DLQ replace
pass-through queue behavior in this internal profile. Generic queue semantics are
not labelled Kafka/RabbitMQ/SQS. Broker pause retains logical state; consumer loss
leaves lease-owned work for actual redelivery.

Objects own namespace/key/current generation/bytes. PUT is atomic at commit;
GET/HEAD/DELETE and conditions operate on current state. Payload sizes feed real
M2D transport without giant simulator buffers. Temporary outage preserves objects.
No LIST/multipart/physical durability/device timing is invented. Producer/worker
pipelines compose compute, pools, broker, object and optional DB calls. Conditional
object effects prevent repeated mutation only at that object; no cross-resource
exactly-once claim. Faults create real backlog, retries and duplicate effects.

Local disposable RabbitMQ HTTP and Node object-reference measurements produced
54 broker + 108 object batches with cleanup confirmed. The complete timing
predictor is **REJECTED** (broker fit/holdout MARE 21.98%/22.99%); protocol/CPU/runtime
attribution remains unresolved. Object timing is Unknown; all 108 logical/byte
populations replay. No cloud/AMQP/SKU/Free Mode promotion or latency correction.
M2D/M2E timing rejections remain preserved. [Research/design/validation](reality/README.md)
retain 3,000 generated cases and backlog, poison, duplicate/ACK-window, atomicity,
outage and large-state executor proofs. Model 1/goldens/challenges remain unchanged.
Next: deeper storage/durability and recovery, with separate registry/log resources
using these seams. Vercel remains queued before hosted/public-preview work resumes.

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
remain absent in the published product. Model-2 keyed RNG now exists only in the
internal foundation. Windows runtime stability (native Bun crashes, `tsc` out of memory on this
host) and external OAuth sign-in in a browser remain unverified; authenticated browser
QA now uses real public credentials in disposable local data. The sample design keeps the two readiness
warnings its domain tests pin (vm-2 has no data path, monitor-1 is unreachable).
Every challenge is still at version 1, so the upgrade path (older-workspace notice,
fresh or copied workspace) is proven by registry fixtures, server-rendered tests and
SQL guards, not by a real second version in the browser. Experiments retain one fault
and a bounded tick window, not continuous monitoring. Evidence before the window,
missing points and production recovery remain unknown. The three earlier resilience
versions still stop on the last active fault tick; their reports gain no invented
post-fault samples. The new challenge observes through its own bounded later evaluation.
Restart fails interrupted work; it never resumes a checkpoint. Recent Met indicators
cover the latest 20 attempts rather than an invented lifetime achievement. Local/CI
proof is not production readiness.

Improvement drafts are browser-history context, not durable unfinished tasks; a
new attempt durably retains its hypothesis. Deleting its source removes the ability
to compare with that source but preserves the child's own evidence/hypothesis.

Next engine work: **storage/durability and recovery** using the M2F queue/object
ownership seams, measured demand and explicit Unknowns. Registry and partitioned-log
semantics remain separate future resources.
Deepen existing resources before expansion or Free Mode/challenge migration. Real
availability, latency, request success, cache warm-up, data recovery and statistical
conclusions remain outside Model 1. Hosted production remains parked.
