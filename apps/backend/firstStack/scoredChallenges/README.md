# Server-owned scored challenges

`infraforge-scored-challenge/2` is public reviewed JSON data. `definition.ts`
validates the format and selects an exact ID/version. The definition digest pins
the brief, constraints, sample, policy, retired practice recordings and private
scoring commitment. Publish a new challenge version when any data changes.
The runtime never evaluates authored code or an architecture answer key.

Each `scoring: { version, sha256 }` commits the entire private bundle, including
its version, challenge identity, hidden workloads and rubric. SHA-256 uses the
recursive sorted-object-key JSON canonicalization in `../canonical.ts`; array
order and string values are preserved. JSON whitespace and file line endings do
not affect the commitment. Private files use that canonical JSON plus a newline.
The bundle schema is `infraforge-private-scoring/1`, with `id`,
`challengeVersion`, `version`, `hidden` and `rubric`. Private workload seeds
override the public sample seed only for their execution.

Version 1 suites are burned and remain readable in Git history. Their exact
workloads are now labelled public practice in each version 2 definition; no
rubric or numeric grading goals remain in public definitions. Version 2 private
suites rotate arrivals, populations, crash timing, seeds, IDs and rubric values
within the same teaching difficulty. All recordings and thresholds are synthetic
teaching fixtures, with no cloud calibration claim. Version 1 is no longer
admitted; historical results remain readable through the existing projections.

Only the scoring server reads `INFRAFORGE_SCORING_DIRECTORY`. There is no default
directory, repository fallback, network fetch or fixture import. The configured
directory must resolve outside the checkout. Each file is named
`<challenge-id>.v<challenge-version>.json`. The loader checks its bounded regular
file, canonical commitment, strict schema and exact identity/version before any
hidden execution. It reads fresh bytes per scoring operation; no stale cache can
hide removal or corruption. Missing, unreadable or mismatched data returns
`infraforge-scoring-unavailable/1`, state `unavailable`, message `Scoring unavailable`.
It grants no points and launches no hidden execution. This safe state passes
through the existing verified-result projection and account export allowlists;
raw errors, paths and bundle contents never appear there or in logs. Public
samples and practice files remain available independently of the private store.

Install and rotate the private store
------------------------------------

The owner-held local bundles live outside Git at
`C:/Users/Rishabh/Documents/1_InfraForge/InfraForge_Private_Scoring/`. Transfer them
over an owner-controlled secure channel; never put them in a checkout, image
layer, CI artifact, build context or public report. On the host, create
`/etc/infraforge/scoring` owned by `root:infraforge`, mode `0750`. Install the seven
files as `root:infraforge`, mode `0640`; the scoring process must belong to that
read-only group. Mount that directory read-only into the process that performs
scoring and set `INFRAFORGE_SCORING_DIRECTORY=/etc/infraforge/scoring` through its
service configuration. Keep the isolated child without access to this mount;
it receives only the one prepared workload input through the existing protocol.
The backend image continues to exclude tests and reference designs.

From the deployed checkout, run
`bun --no-env-file scripts/check-private-scoring.ts`. This verifies every public
commitment with the production loader and executes the existing two qualifying
capacity designs and weak capacity design for all seven scenarios. Output is
restricted to public scenario IDs and pass/fail results; it prints no private
measurements or workloads. This is an in-process software check with synthetic
receipts, not Linux containment evidence. A failure exits nonzero and does not
print underlying private diagnostics. Do not substitute a byte-file `sha256sum`
for the canonical JSON commitment check.

For future rotation, create new challenge and bundle versions in the private
authoring location. Preserve each lesson, fault type, workload count and
difficulty; choose fresh concrete workloads, seeds and rubric values. Qualify
the existing passing and failing capacity designs before publication. Set the
public commitment to `hash(parsedBundle)` using `../canonical.ts`, and publish
only the public definition. Install the corresponding private files before
admitting their new version. Keep old immutable version files while old queued
work may still reference them; never replace bytes behind an existing version.
If the backend later moves private, move the store with it without changing this
commitment contract. Test fixtures under `tests/fixtures/scoring` remain clearly
fake and never authorize a production commitment.

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

The cache-free R1 library follows the tutorial in this order. Each `/2` definition
contains a visible sample, two retired public practice recordings and a commitment
to two new private recordings, with different app-loss targets and timings.
Capacity edits remain 1..4 cores, 1..32 workers and 0..64 queued requests
per app, with matching host cores. These are finite teaching assumptions.

| ID | One lesson | Executed API slice |
| --- | --- | --- |
| `url-redirect` | Keep spare app capacity when a popular link meets app loss. | Preassigned keyed redirect lookup. |
| `catalogue-api` | App workers share a finite database dependency. | One fixed three-record product page. |
| `reviews-api` | Waiting database work occupies workers even when CPU is available. | One fixed four-review page with authored blocking time. |
| `small-paste-api` | Response bytes use finite directed transport capacity. | Prepared 4 KiB text lookup. |
| `preloaded-news-api` | Concentrated waves matter more than the average arrival rate. | One fixed two-record article page. |
| `price-history-api` | Historical reads retain a finite shared database demand. | One fixed eight-record history page. |

The compiler accepts one fixed range key list per operation; these versions do
not imply variable ranges or arbitrary SQL. Read-only datasets are preloaded.
The briefs name further exclusions, goals and observation windows. Every mandatory
goal must pass on both hidden workloads; tests replay two passing capacity choices
and reject a one-core, one-worker, zero-queue design for every scenario.
