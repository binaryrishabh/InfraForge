# Authoring challenges

## Beginner on-ramps

`keep-waiting-work@1` changes only Message retention (seconds). The queue
already has space and one worker keeps its fixed work and concurrency. At second
170, extending retention from 1 to 60 seconds changes acknowledged messages from
151 to 218 and expired messages from 79 to 0. The passing snapshot still has 11
ready messages with oldest ready age 10.996246 seconds. Both runs accept all 230
producer requests. This teaches message expiry rather than the capacity refusals
in `analytics-burst-buffer` or worker optimization in `keep-up-with-the-queue`.
Saved reports render acknowledged, expired, ready and oldest ready age; absent
observations and the absence of an oldest ready message stay Unknown.

`check-the-missing-server@1` changes only Check interval (seconds), from 60 to 1.
Two apps already have sufficient survivor capacity. Under the same `vm-crash@1`
script, completed callers change from 800 to 1150 and failed callers from 400 to
50 through second 12. More survivor CPU does not repair routing to the failed
peer. This teaches detection rather than adding headroom or another server.
Final health and p95 match in both runs and cannot erase earlier caller failures.

Both are starter challenges with beginner lessons, one-setting hidden references,
failing near misses, refusal tests, browser/server replay proofs and real report
rendering tests in `beginnerOnramps*`. These numbers are deterministic educational
outputs, not provider benchmarks or availability guarantees. No engine behavior
or previously published challenge definition changes for these labs.

`share-a-cache-fill@1` changes only the cache's saved Single-flight setting. One
read-only key and an app-owned aside expose overlapping fills during an authored
database CPU slowdown. Calibration compares independent real runs: second-5 p95
142.648 -> 3.754 ms, with 1000 callers completed and none unsuccessful in either.
The capacity-only near miss retains the failing tail. Existing `terminal-p95`
and `caller-outcomes` criteria score saved outcomes; raw database fetches and
coalesced waiters support calibration but are not saved report measurements.
No whole-run latency, continuous recovery or cross-replica coordination is claimed.

## Architecture choices

`cache-or-database@1`, `one-vm-or-a-pool@1` and `limit-or-capacity@1` each have two
passing designs under fixed requirements. Hidden designs remain in the test harness.
Cost comparisons are educational estimates; the gateway estimate remains Unknown.
Cache counters are checked during replay calibration, not claimed as saved report fields.

`caller-outcomes` uses the retained `traffic.wholeRun` populations through the exact
evaluation second: completed must meet a positive minimum; failed + deadlineExceeded +
abandoned must stay within a nonnegative limit. In-flight work belongs to neither
population. Missing capture/design, stale topology, absent or malformed counters,
mismatched cumulative windows and unsafe totals remain unscored. The existing generic
requirements list renders the resulting label, status, detail and evidence sources.

`vm-crash@1` is a versioned scenario intervention for a fixed primary VM compute role.
Its duration includes an explicit one-second restart and must be at least two seconds.
It compiles to the existing Crash cancellation, service-state and readiness mechanisms;
its receipt ends only when readiness restores. Overlapping crashes and replacement
windows are refused. No process failure is substituted with a link partition.
The pool exercise evaluates cumulative callers as well as final latency so a fast
post-restart sample cannot conceal earlier caller failures. No continuous-health or
availability assertion follows from these measurements.

Challenges are source-controlled. There is no admin interface and no database-authored rule.

## Identity and versions

A challenge attempt is judged by `challengeId + challengeVersion + specHash`. The spec hash covers
every authored field, so an attempt always records the exact rules it ran under.

- Each version lives in `definitions/<id>/v<n>.ts` and is registered in `definitions/index.ts`.
- **A published version never changes and is never removed.** Old attempts are judged by it forever.
- To change anything, add `v<n+1>.ts`, register it and pin its hash in
  `tests/challengeAuthoring.test.ts`. The list shows the latest version; old reports keep theirs.
- Versions run 1, 2, 3… without gaps. Seeds are per version (`challenge:<id>:v<n>`).

A new version is required for any change to: workload, evaluation second, criteria, prediction
questions, the starter, the experiment, hints, debrief, story, objective, title or summary. Spelling
and punctuation are included: a published version is byte-for-byte immutable, so a typo fix waits
for the next material change or ships as its own version. This keeps "the rules this attempt saw"
exact without a separate notion of cosmetic edits.

Shared helpers used by published versions (`starter.ts`, `definitions/modelNote.ts`) must not change
behaviour; the pinned hashes fail if they do.

## Workspaces

A workspace design belongs to one challenge version. Opening a newer version never reuses an earlier
workspace silently: the learner starts from the new starter, or explicitly copies the earlier design.
Attempts always run the latest version, from a workspace of that version.

## Resilience challenges

An optional `experiment` makes a resilience challenge: one fault InfraForge applies itself.

- `fault`: a model-1 fault (`crash`, `cpu-spike`, `memory-leak`, `network-delay`, `disk-failure`).
  Read its engine semantics before writing about it.
- `target`: a named starter resource and its type. The learner must keep it, in the serving path
  (and for an app server, behind a load balancer that manages a pool). Nothing is substituted.
- `atSimulatedSecond`: no earlier than the end of the 60-second ramp.
- Without `postFaultObservationSeconds`, `evaluationSeconds` stays the fault's last active tick
  (`at + model duration`). Existing published definitions omit the property and stay unchanged.
- New exercises may explicitly author `postFaultObservationSeconds` (integer 1–60). Evaluation
  must equal `at + model duration + observation`. The whole inclusive trace must still fit
  `max(0, at - 30)` through evaluation in **121 points**; some fault durations allow less than 60.
  The run already stores the immutable evaluation stop, plan and definition hash; no schema
  change or extra recorded-plan key is needed. Browsers cannot override the period.
- Tick `at` measures before application; `at + 1` first measures the fault. Tick `at + duration`
  still measures its effect, then removes it and completes its durable action. Post-fault
  measurements are strictly later. Previous-tick cascades, provisioning and restarts can persist.
- Only ask predictions the retained evidence proves: `baseline-health` (recorded when the fault is
  applied), `target-health`, `survivor-health`, `database-health`, `busiest-type`, `scale-out`,
  `overall-health`. A post-fault overall-health prediction is useful; during a crash it is always
  critical. Use later-evaluation criteria before inventing a recovery criterion.

## Scripted Model 2 scenarios

New versions may instead supply `scenario: {version: 1, visibility, steps}`. A scenario and
legacy `experiment` are mutually exclusive. Steps have unique ids, integer `atSecond >= 1`
and exact versioned intervention requests. There are at most 20 steps. Authored order breaks
ties; tick S completes before application at S * 1,000,000 + 1 microseconds. Timed effects
restore at that microsecond plus duration, strictly before evaluation.

Attempt creation precompiles the entire script against the learner's captured topology,
including future overlaps. Missing or unsupported targets are refused without substitution.
The immutable attempt plan records the definition hash, model/catalog/profile selection and
resolved receipts. The browser runs the script but submits no scripted actions; the server
reconstructs it from that plan and establishes each durable action before advancing past S.
Only exact stored steps may carry the internal scenario step id; learner interventions remain
refused. Scoring requires every exact application and end receipt plus terminal evidence.

Database member failures and promotion are currently available only in Free World live runs.
The scenario validator rejects `db-fail-primary`, `db-fail-replica` and `db-promote-replica`,
even though the engine implements them. The saved canvas has no promotion-step or timing
setting. Adding a step to a definition changes its authored rules; it is not a learner design
change. A lab that requires the learner to add promotion needs a captured recovery-plan
control and scenario support before it can meet the runnable-lab standard.

`tests/databasePromotionEvidence.test.ts` verifies the Free World mechanism, browser/server
parity, saved measurements and challenge refusal. Those runs are regression evidence, not
scored challenge attempts. The `data/writer-failure` lessons remain conceptual. Promotion
clears the old pending-replication population; zero pending work and new writer commits do
not alone prove preservation of earlier commits. The model does not create a second replica
after promotion. Keep data-preservation and automatic-failover claims outside these totals.

Use `revealed` for this slice. `debrief` is a presentation designation: a browser-executed
script is inspectable and provides no secrecy. No hidden-reveal UI is provided.
`terminal-p95` uses existing completed-request traffic evidence at the exact evaluation second;
missing latency or no completions stays unscored. It makes no continuous-window claim.

`bound-retries-during-slowdown@1` reduces DB CPU at second 2 for two seconds and evaluates
at second 5. Its starter's 1748.415 ms p95 fails the 1000 ms limit; the bounded-retry reference's
859.495 ms passes. Both estimate $240/month. These are deterministic educational outcomes,
not availability or cloud-performance guarantees. All earlier definitions and pins remain intact.

## Post-fault evidence and calibration

`evidence/observation.ts` derives target and whole-system facts independently, only after the
scheduled action confirms its exact end. `healthy-observed` means at least one retained Healthy
sample, even if evaluation is unhealthy. `unhealthy-through-window` requires every post-fault
second for that subject through evaluation and no Healthy sample. Otherwise the answer is
`unknown`. `no-samples` differs from `fault-end-unverified` and from a legacy `not-applicable`
window. Evaluation health requires its own retained measurement.

First Healthy facts carry continuity from the expiry tick through that sample. A missing sample
or missing subject qualifies the wording as **after missing evidence**. A later gap does not erase
an earlier observation. Never say Healthy since, recovered by, faster recovery, MTTR or production
availability. First retained Healthy sample and health at evaluation are different facts. Compare
shows these values side by side, under its existing conditions classifier, without ranking designs.

`bun --cwd apps/backend --no-env-file tests/recoveryExploration.ts` explores **3,240 deterministic
candidates** across five faults, target types, workloads, database sizes, redundancy, pool limits,
CPU thresholds, fault timings and observation horizons. This is offline calibration, excluded from
the runtime. Initial cache candidates settle; the selected `after-the-cache-returns@1` retains a
second lesson: delayed scale-out changes later database connection pressure. Its starter fails,
its hidden one-change reference passes, and its 106 samples fit the existing bound.

`after-the-cache-returns@2` combines cache recovery and per-instance pool pressure in Model 2.
Its authored workload is 600 requests/s (90% reads, 10% writes), with a fourfold burst at seconds
120–140. The cache crashes at 105, ends its crash at 135 plus one microsecond and restarts at
136 plus one microsecond; 137 is its first available sample. Evaluation at 137 deliberately
observes the ongoing burst after the cache returns, rather than scoring an already idle database.
The identical no-fault control scales out too, but cache hits keep its database Healthy with spare
sessions and no refusals through evaluation plus 20 seconds. During the outage, independent
fallback reads fill the pools; writes invalidate the cached key and contribute to the return tail.
The burst crosses the app's 20% CPU target: eight replicas can grow to 24, taking possible pool
sessions from 80 to beyond the database's unchanged 85-session limit. The DB-tier-only reference
adds both CPU capacity and session headroom; capping replicas alone does not fix database CPU.
Health samples use interval CPU and recent errors (including session refusals); idle sessions
alone do not imply saturation. The starter has live/queued work at 137–140, drains at 141 and is Healthy at 142. The unchanged
statement/transaction deadlines are authored 1s/2s, statement CPU costs 1ms/read and 2ms/write,
cache deadlines 10ms, and caller concurrency 512. These are educational assumptions, not provider
defaults or performance guarantees. No retry policy is enabled. `cache-failure@1` stays retired.

Research applied to model 1 (not imported as real-cloud guarantees):

- [Principles of Chaos Engineering](https://principlesofchaos.org/): explicit measurable hypotheses;
  model health is only an internal educational proxy, not user-visible steady-state output.
- [Chaos Toolkit experiment specification](https://chaostoolkit.org/reference/api/experiment/):
  actions, pauses and subsequent probes distinguish intervention from later observation. InfraForge
  needs one authored horizon, not a workflow language or an adaptive wait-until-healthy stop.
- [Google SRE cascading failures](https://sre.google/sre-book/addressing-cascading-failures/):
  interacting resource pressure can outlast the trigger. Model 1 used previous-tick health and
  discrete provisioning; it has no real retry queue, cache warm-up or persistent leaked memory.
- [OpenTelemetry metrics data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/):
  timestamps and gaps matter. Retained point measurements cannot establish continuous health.
- [W3C complex images](https://www.w3.org/WAI/tutorials/images/complex/): phase labels, native
  sample selectors, key-moment tables and text alternatives accompany the unsmoothed charts.
- [DORA metrics](https://dora.dev/guides/dora-metrics/): recovery-time metrics depend on a defined
  failure population and endpoint. A first Healthy simulator sample is neither deployment
  recovery time nor a mean across incidents; an unfinished window is not an infinite duration.
- [PhET guided inquiry](https://phet.colorado.edu/files/guides/UG-Guide-HW_en.pdf): predictions,
  exploration and explanation support inquiry. InfraForge keeps a short prediction, an evidence
  review and a learner-owned one-change hypothesis, without asking for an exact recovery second.

## Scaling labs

`route-around-a-slow-vm@1` compares saved `lbSelection` policies under an unchanged
CPU quota. `leave-room-for-a-burst@1` scores second 125 during the modeled 120-140s
burst, and compares catalog CPU headroom with educational monthly estimates.
Neither terminal-second latency requirement is a whole-run SLO.

`retrying-a-full-pool@1` uses `backend-admission-budget`: sum `acceptedByBackend +
rejectedByVm` from `lb-accounting/1` for every captured load balancer, divided by
whole-run `completed + failed + deadlineExceeded + abandoned + inFlight` callers.
Both counts must cover the evaluation second with current topology measurements.
Missing counters, a missing LB sample, a mismatched cumulative window, zero offered
callers or unsafe counter precision leave the requirement unscored. Queue counters
overlap admissions and are never added. A passing load budget can coexist with a
saturated service and does not establish sufficient throughput or availability.
The criterion renders through the existing generic requirement list.

## Database labs

`reuse-before-expiry@1` isolates cache lifetime from logical capacity. The
read-only uniform working set already fits. Changing only Cache TTL reduces
expiry-driven source reads and second-6 completed-request p95; increasing only
logical capacity leaves the expiry behavior unchanged. All three runs use the
same captured workload and seed. Cumulative caller outcomes are scored alongside
terminal latency. Live cache populations are calibration evidence, not retained
saved-report fields; the lesson names only saved latency, CPU, health and caller
measurements. No mutable-data freshness or whole-run latency guarantee follows.

`move-reads-off-the-writer@1` compares explicit primary-only and replica-preferred
routing with unchanged capacity. Member CPU work and read-source counts show reads
moving while primary commits continue. Aggregate CPU averages both member budgets,
so a Healthy database can hide a busy primary. The captured fixed-delay replication
also records stale reads; lower latency does not establish application consistency.

`budget-app-database-sessions@1` fills lazy per-instance pools during a two-second
CPU slowdown, then scores spare sessions and completed-request p95 in second 6.
Changing only the load balancer pool minimum changes initial Model 2 instances;
this run ends before the first ten-second controller evaluation. The reference
avoids session refusals but still has whole-run failures and a longer latency tail.

`replicas-do-not-take-writes@1` makes adding a replica an instructive near miss:
application writes stay on the primary and caller latency is unchanged. The
db.t3.micro tier reference increases writer capacity; its other tier settings
change too. A few replica reads are startup probes, not application read traffic.

Reports retain validated optional database populations, replication counters and
member routing measurements from the terminal capture. The existing live database
readouts also render them in saved reports. Missing historical counters stay absent;
malformed counters cannot produce a scored terminal measurement. All three latency
requirements concern completions in second 6, not a whole-run SLO.

## Asynchronous work labs

`keep-up-with-the-queue@1` compares one worker's authored CPU milliseconds per job
under steady publishing. `leave-time-to-acknowledge@1` changes only queue visibility
while retaining the real saved acknowledgement delay. `open-one-subscriber@1`
opens one queue listener; independent Event Bus dispatch and the other consumer
remain measurable. These are fixed-horizon labs, not burst-drain or availability tests.

The `queue-work` criterion reads optional `queueWork/1` terminal measurements from
the named enabled queue, at the exact evaluation second and current topology revision.
Each capture carries its own `throughSecond`. Originals, deliveries, acknowledgements
and successful object effects come from separate broker and worker counters; processed
effects do not acknowledge a delivery. Outstanding work is ready + in flight + scheduled.
Original ownership reconciles with outstanding + acknowledged + dead-lettered +
discarded + expired. Unsafe, inconsistent or missing counters stay unscored. Historical
captures without these counters remain readable and cannot satisfy the new criterion.
Recorded zero work fails the positive acknowledgement minimum; it is never inferred
from missing evidence. Generic requirement details display every population and limit.

The cheap current counter accessors expose existing engine state; no queue behavior,
published definition or historical pin changes. Bus dispatch failures and queue consumer
redeliveries are different stages and must not be combined into one failure population.

## Security and incident evidence labs

`find-the-denying-rule@1` begins with a failed dependency and a clean exposure scan.
The learner runs unchanged, reads the saved rule counters, then submits a diagnosis
prediction in another unchanged attempt before editing. `database-admission` classifies
incoming database denials from complete fixed direct paths: policy, missing listener,
other/mixed, or positive delivery without denials. Safe counters and current terminal
evidence are required. Missing paths, missing counters, helper or replica coverage,
and no positive admission/delivery population leave the answer Unknown. Rule counters
identify the policy decision; CPU or health alone do not. The prediction does not
establish application correctness or explain every caller error.

`leave-room-for-firewall-flows@1` separates tracked admission, current occupancy,
expiry, policy denials and flow-capacity refusals. Its startup probe refusals coexist
with successful callers; removing those refusals is not an availability improvement.
`firewall-admission-budget` requires a named captured firewall, positive admission
minimum and safe cumulative denial/refusal limits at the exact evaluation second.
Missing optional security counters remain unscored, never inferred as zero. Omitted
connection detail rows do not erase exact aggregate counters. These new admission
exercises require valid scan-stage evidence; historical definitions keep their rules.

Reports now preserve validated optional security measurements and reuse the existing
security readings. Omitted connection details stay Unknown. These counters were
already produced by the engine; neither its behavior nor historical definition hashes
change. No packet-level evidence, provider security certification or availability is
claimed.

`choose-a-retry-mitigation@1` partitions the app-to-database link at second 2 for two
seconds. Four, two and five maximum attempts are compared under the identical script.
Two attempts reduce second-6 completed-request p95 and cumulative admission pressure,
but also reduce whole-run completions. Five attempts worsen the measured tail and
queue admissions slightly while finishing an extra caller. Requirements score the
stated tail only; a Healthy terminal sample is not continuous recovery or MTTR.

There is no DNS-cache lesson here: resolver state is not retained in saved reports.
Scenario serving-path validation currently refuses a background-worker outage, and
the intervention catalog has no VM or load-balancer process-outage action. Those
limits are not bypassed or relabeled as implemented outages.

## Application missions

`catalogue-link-flash@1` combines app burst headroom and logical cache capacity
on DNS -> LB -> app -> cache -> database. The captured workload uses sixteen
keys with the existing fixed hot-key pattern and a fourfold arrival burst at
120-140; popularity itself does not change. Each partial design fails a fixed
second-125 requirement. Four controlled runs isolate the two necessary settings,
one at a time. Saved reports prove caller latency, outcomes and database CPU;
cache hit/miss/eviction counters remain live-only in this report format.
ID uniqueness, key-value and HTTP redirect semantics, mutable-data correctness,
arbitrary popularity traces, DNS failover and availability are not verified.

`flash-sale-order-backlog@1` combines worker CPU work and acknowledgement leases.
The existing upload/publish journey requires the app as its direct entry point;
it refuses load-balancer polling, so this mission does not claim frontend routing.
Four events/second become sixteen at 120-140, then four again. Its criteria use
cumulative queue counters and second-170 health/latency. Controlled engine
captures at 140 and 170 show excess outstanding work decreasing despite new
arrivals. The terminal report alone does not prove exact drain time or continuous
health. Each partial fix still fails; faster processing with an inadequate lease
can actually increase redeliveries. Payments, stock guarantees, distributed
transactions, order correctness, exactly-once effects, physical durability and
dynamic worker scaling are not verified. All capacity inputs are educational.

These missions reuse existing criteria and replay/report paths. No simulator,
scoring system or attempt history is added. The `missions` lessons list existing
earlier lessons as advisory prerequisites, with one small lesson file per mission.

## Resource depth labs

`protect-one-api-route@1` changes only the read route's initial burst credits.
Its independent token bucket protects a one-worker upstream while the write
route retains the same admission and completion counts. The engine has no
selectable shared route bucket. Gateway command CPU, transport and the global
in-flight bound remain shared; this controlled result is not a universal
fairness or no-starvation guarantee. Deliberate rate refusals still count as
failed callers, so protection can pass with unhealthy overall health.

`queue-overlapping-jobs@1` changes only scheduler overlap from allow to queue.
The first cold invocation lasts beyond several due times. Queuing delays starts
while preserving all twenty timer jobs; skip loses triggers and allow hits the
function's concurrency ceiling. Foreground caller outcomes and scheduled jobs
are separate populations. The saved start delay is not a recovery-time claim.

`bound-function-pool-pressure@1` changes only function concurrency. It reduces
cold starts and connection wait on the shared ten-session database pool, but
increases throttles and reduces total completions. Both the useful-completion
minimum and the refusal budget matter alongside second-3 p95. This is not
database session exhaustion: open sessions remain below the database limit,
with zero session refusals. The challenge serving-path validator currently
refuses the session-capacity intervention for this function path; it is not
bypassed. Function instance timing and CPU/database capacity are educational.

The new `gateway-route-work`, `scheduler-work` and `function-work` requirements
read existing validated optional counters at the exact evaluation second with
current topology measurements. They require named captured resources, positive
completion minima and safe nonnegative limits. Route outcomes must match saved
bindings; scheduler attempt accounting and function lifecycle measurements must
exist. Function work must retain its attached database path. Missing, malformed,
stale or historical evidence stays unscored. Requirements use the existing
generic label/status/detail rendering. No engine behavior or published version
changes, and no second judge, report store or attempt history is introduced.

DNS cache versus record changes remains outside this slice: saved reports lack
resolver populations, and no usable record-change/outage challenge was
calibrated. Load-balancer process outages are not supported by the intervention
catalog; no recovery-time or partial-recovery lab is claimed. Event bus retry
exhaustion already appears in `open-one-subscriber@1`; a separate calibrated
retry/dead-letter-overflow exercise is not added here.

## Check

`parallel-jobs-for-a-burst@1` changes only Jobs in parallel from one to two
on an existing two-core worker. At the burst's end, second 140, the report
compares acknowledgements and all outstanding work with broker-ready depth
and age. Raising only prefetch is a deliberate near miss: jobs move into
leases and ready age becomes Unknown while useful completion remains too low.
Worker count, autoscaling and arbitrary slow-message classes are unavailable.

The `queue-ready-age` requirement uses the existing optional saved `asyncQueue`
observation plus matching `queueWork/1` ready count, current topology and the
exact evaluation second. A nonempty ready population requires finite age
between zero and elapsed run time. An observed zero ready count meets the
requirement with null age explicitly; null age alone never establishes zero
waiting. Missing, stale, inconsistent or malformed evidence stays unscored.
This is a single sample, excluding leased jobs, not a whole-run wait target
or backlog drain time. No engine behavior or historical definition changes.

```
bun run check:challenges
```

It validates every version (structure, bounded text, unique ids, contiguous versions, unchanged
published hashes, valid starter graph, experiment target and timing), runs every latest version
against the real engine (the starter fails, a hidden reference passes) and confirms the hidden
reference designs, which live only in `tests/challengeHarness.ts`, are not imported by runtime code
or packaged.
