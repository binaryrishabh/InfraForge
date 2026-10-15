# M2C verification and limits

Starting checkpoint: `62b277fc92d8b0630b488539f5bff0996f04b7d5` on `develop`,
accepted M2B [CI 38733042083](https://github.com/binaryrishabh/InfraForge/actions/runs/38733042083),
10/10 green. The starting local/remote alignment, clean worktree, internal dispatch,
Reality inventory and M2B artifacts were checked before implementation. All 30 Model-1
goldens passed before edits. Final regression also checks every immutable challenge
hash. No Model-1 physics, constants, RNG, fault behavior or catalog is edited.

## Mechanism proofs

[m2c-proofs.json](m2c-proofs.json) is reproducible with `bun run debug:compute --write`.
All demands/footprints in these teaching cases are explicitly synthetic, with ledger
provenance. They verify mechanisms, not external calibration.

| Proof | What it establishes |
| --- | --- |
| A: unused capacity | Four CPU units/eight workers/one single-threaded invocation consumes one CPU unit; configured idle workers reserve nothing. A separate parallel-cap test permits two units only when declared. |
| B: contention | More runnable work than CPU shares capacity and accumulates queueing; CPU service reconciles. |
| C: blocked workers | Application wait retains worker/memory while CPU remains available for eligible work. A separate legacy DB dependency test checks the same local distinction. |
| D: same offered load, workers 1 vs 8 | Worker availability changes results through admission/queueing/scheduling, without a throughput multiplier. |
| E: finite competing CPU work | A matched control and competitor case have the same application load/two workers/two CPU units. Competitor service reduces application availability and caller completions. |
| F: distinct resident footprints | Identical CPU/outcomes with different synthetic request/active bytes produce different live memory populations. |
| Pause | Local CPU/application wait stops and resumes; ownership survives. Downstream work has independent execution. |

Focused tests also cover quota exhaustion/replenishment, zero capacity, integrated
capacity changes, completion/pause ties, cancellation/detachment, partial resident
coverage, application-specific components, allocation rejection versus observation,
private input snapshots, immutable returned evidence and paused quota observation.

## Conservation and determinism

The 3,000-case deterministic sweep varies CPU capacity, workers, queue size, light/heavy
demand/mix, arrivals, deadlines, blocking wait, pause timing, competitor demand, quota,
capacity changes, memory footprint/limit and cancellation capability. It checks caller
and invocation partitions, consumed core-time bounds, nonnegative remaining demand,
worker partitions, known resident sums and live memory ownership at samples/end.
Selected cases repeat through different playback batches. Separate tests compare
sampling cadences, multiple compute resources, router/backend order and profile order.
Synthetic generated coverage is not an external calibration claim.

Observation only projects state. Scheduler anchors/rates/remaining demand do not
change when evidence is requested. Input and returned metadata are privately copied.
Integer-us completion rounding can leave sub-microsecond capacity unused; demand is
never rounded upward. Floating core-time conservation permits 1e-6 core-us absolute
arithmetic tolerance. Arrivals keep the M2B keyed RNG; service variation remains
Unknown, so M2C adds no distribution sampling/global RNG stream.

The calibration tooling replays 48 real measured batches and eight candidates,
checks benchmark source/environment hashes, disjoint fitting domains and exact
artifact regeneration. A deliberately corrupted holdout exposes large residuals
without changing fitted values. Proof artifacts are also replayed and compared.
See [calibration](m2c-calibration.md) for errors and the unsupported transfer hypothesis.

## Executor performance

[m2c-performance.json](m2c-performance.json) records one local Bun run per worker count.
Each authors 10,000 calls, four CPU units, 100 core-us/call, ten us application wait,
one-us arrivals and 100 retained raw outcomes. The 64-worker case also has quota,
pause/resume and a finite competitor. Every case drains all 10,000 calls and releases
invocation memory. These timings are host/interference/GC dependent, not guarantees.

| Workers | Execute ms | Processed events | CPU boundary events | Peak pending | Final pending |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 359.3 | 30,004 | 10,000 | 9,912 | 0 |
| 8 | 533.5 | 25,074 | 5,070 | 9,612 | 0 |
| 64 | 1,482.3 | 28,079 | 8,071 | 9,941 | 0 |
| 256 | 3,619.6 | 29,937 | 9,933 | 9,747 | 0 |

There is one replaceable CPU boundary per resource, not one stale completion per
worker per share change. Indexed kernel cancellation removes superseded callbacks.
The roughly 10,000 pending peaks are mainly legitimate outstanding caller deadlines,
not retained obsolete CPU callbacks. Setup is 1.4–10.9 ms, aggregation 1.4–3.0 ms,
serialization below 0.4 ms and output about 86–103 KB. All 10,000 terminal counts
remain represented despite 9,900 omitted raw rows. Heap snapshots are GC dependent.

Settlement/projection scan runnable jobs; capped sharing sorts them. Memory projection
scans live owners per operation. Those costs remain visible at large worker/queue
counts. Measured bounds did not justify a more complex scheduler/index in M2C.
Implementation guards cap workers at 512, quota boundaries at 1,000,000, interventions
at 1,024 and named components at 64 per component list. These are executor policies,
not hardware facts, and their ledger entries are included in evidence.

## Final checkpoint and publication boundary

Final validation covers frozen install, workspace source/test typechecks, lint,
boundaries, workspace/tooling tests, Reality inventory/ledger, M2B/M2C calibration
replay, all 30 Model-1 goldens, ten published challenge hashes, frontend build and
dependency audit. Disposable PostgreSQL/Redis integration and ordinary packaging
are verified by exact-SHA CI. No manual release rehearsal is needed for nested
internal code excluded from runtime packaging. The final closeout records actual
command results, commits, remote alignment and CI outcome; this document does not
predict an unknown commit hash or future CI status.

No schema migration, UI redesign, SKU mapping, Free Mode activation, challenge
migration, deployment or production access is part of M2C. Database remains the
legacy dependency proof. Network transport/bandwidth/packets/connections are deferred
to M2D; there is no fake network delay. Real physical topology/frequency/SMT,
service-demand variance, weighted groups, RSS attribution, reclaim/swap/OOM/GC and
provider scaling remain unvalidated or unmodeled. Production remains PARKED.
