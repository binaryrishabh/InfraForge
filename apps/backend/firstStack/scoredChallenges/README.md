# Server-owned scored challenges

`infraforge-scored-challenge/1` is reviewed JSON data. `definition.ts` validates
the format and selects an exact ID/version; the definition digest pins the entire
brief, constrained design space, sample, hidden suite, fault schedules, observation
cohorts, policy, rubric and provenance. Publish a new version when any data changes.
The runtime never evaluates authored code or an architecture answer key.

The sample endpoint on the inactive submission router enumerates its response
fields. It returns only the brief, constraints, template, resolved visible schedule
and visible policy. No registry object, hidden workload or rubric is a client
contract. The import-boundary checker also forbids the entire server-only folder
in the web closure, including JSON, type-only imports and transitive exports.

A scored request names `challenge: { id, version }` and saves the returned sample
sidecar with its allowed capacity edits. Admission locks the owned saved design,
checks its timestamp and revision, validates every fixed semantic input and
resolves the sample again. The ordinary browser-cut verification remains first.
A mismatch never starts the hidden suite. Private/shared requests cannot supply a
challenge, and scored requests cannot choose arbitrary workloads or policies.

The serial worker holds the existing session ownership across the sample and
all hidden executions. Each hidden workload resolves against a copy of the saved
design; only server-owned workload references and faults change. The existing
isolated executor runs each copy. Its cuts are validated under the hidden input
and compile lock, while the visible durable-cut table remains sample-only.
Only the latest bounded hidden cut is retained in memory for each workload.
After confirmed cleanup, the worker atomically appends the complete versioned
score audit to `FirstStackResult`, protected by the existing result hash,
append-only trigger, authorization/token fence and capture budget. A worker crash
retains the reservation in recovery; hidden work is never resumed or retried.

The audit contains the exact hidden inputs, engine source/image, saved design
lineage, workload IDs/versions/digests, rubric snapshot, server cuts, receipts and
per-criterion outcomes with Unknown reasons. The read endpoint explicitly projects
an aggregate score summary. Raw audit data never enters the RunRecord experiment,
report, or client score summary. A missing/corrupt result yields no score summary.

The first scenario is a finite redirect lookup during loss of either app process.
All offered foreground rows belong to one half-open observation cohort wholly
inside the declared outage. This lets the existing caller reducers provide exact
cohort counts without reconstructing a window from sampled health labels or a
truncated diagnostic journal. Outcomes are observed through the execution horizon.
Delivered/error fractions cover all offered callers; p95 covers completed callers
and requires at least 20 observations and an exact retained quantile. Missing
windows, unfinished callers, missing quantiles and unsupported cost are Unknown.
Threshold equality passes; fractions are compared deterministically.

Demands, thresholds, timings and synthetic recordings are authored software
exercise assumptions. They reuse no Model 1 grading constants and claim no cloud
calibration. The starter fails the burst; multiple permitted capacity choices meet
the required caller goals. Timing remains assumption-only. Cost is an optional
unassessed criterion with a null threshold until comparable supported pricing
exists; it earns no point. Full cost remains Unknown. `systemPassed` requires all
mandatory outcomes to pass; the assessment stays incomplete while any criterion
is Unknown. There is no total-score renormalization, certificate or readiness claim.

Public admission and Model 2 activation remain closed. Qualification tests use
the real routed first-stack runtime with explicitly synthetic executor receipts;
they are not host containment, database integration or Linux proof evidence.
