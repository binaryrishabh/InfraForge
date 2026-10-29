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

`after-the-cache-returns@2` restores the two retired cache lessons as one Model 2 exercise.
It uses independent app pools, real database session admission and a cache crash, with a DB-tier-only
reference change. At second 42 the starter's cache is Healthy but its database is Saturated at 85/85
sessions (4.2% CPU); the reference is Healthy at 63/1,360 sessions. Actions apply one microsecond
after a sampled second, so a crash applied at 10 ends at 40 plus one microsecond and restarts
at 41 plus one microsecond; 42 is the first sampled cache return. The short retained tail is deliberate:
canvas database deadlines remain authored 1s/2s, cache deadlines are authored 10ms, and the load
generator permits 512 concurrent serial connections. These are not PostgreSQL, Redis or browser
defaults. No retry policy is enabled. `cache-failure@1` stays retired and historical versions stay pinned.

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
