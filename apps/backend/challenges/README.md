# Authoring challenges

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

## Check

```
bun run check:challenges
```

It validates every version (structure, bounded text, unique ids, contiguous versions, unchanged
published hashes, valid starter graph, experiment target and timing), runs every latest version
against the real engine (the starter fails, a hidden reference passes) and confirms the hidden
reference designs, which live only in `tests/challengeHarness.ts`, are not imported by runtime code
or packaged.
