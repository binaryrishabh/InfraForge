# M2E mechanism verification

Focused tests cover stateful warm-up, exact expiry, capacity eviction/refusal,
coalescing, ordinary read/write separation, lock retention/deadlocks/upgrades,
lock/statement/transaction timeouts, rollback, own writes, insert size/uniqueness,
session limits/closure, DB outage with cached success, CPU capacity, immutable
observation and Unknown/multiplexing refusal. M2B/M2C/M2D regressions remain required.

The 3,000 deterministic cases vary workers, client pools, server sessions,
transaction admission, CPU, query class/multistatement writes, keys/value bytes,
TTL/capacity/policy, commit acknowledgement, deadlines, cache/DB outages, flush,
coalescing and CPU/session interventions. Conservation runs during and after each
case; every hundredth case repeats with different advance boundaries. Synthetic
sweep success is not external calibration. Existing M2C/M2D sweeps remain separate.

`debug:data` replays the committed synthetic proofs (`m2e-proofs.json`):

| Proof | Actual mechanism result |
| --- | --- |
| Normal warm cache | 24/24 callers complete; 3 DB fetches, 22 hits including real health work |
| Cache outage + flush/recovery | 24/24 complete under authored fallback; fetches increase to 10; later fills/hits restore warm state |
| DB outage | Cached k0 still serves; required backing calls fail; 12 complete / 12 reject over the proof |
| Stampede / coalescing | Same 40 callers complete; actual DB fetches decrease 8 → 1; coalescing is explicitly enabled |
| Capacity | Eight-key cycle with two-entry budget causes 30 real evictions and subsequent misses |
| TTL | One key repeatedly expires/refills: four removals, seven backing fetches, ten hits |
| DB exhaustion / more workers | One client DB connection and one server session: 2/32 complete, 30 reject; doubling 32 → 64 workers does not bypass the limit |
| Independent / conflicting writes | Eight simultaneous transactions: peak lock waiters 0 → 7; same-key work serializes and one lock timeout occurs |
| Caller timeout | Ten deadlines expire; ten later remote outcomes remain; backing transactions still commit |

Counts include real LB health operations in resource evidence, while caller totals
exclude those probes. `databaseFetches` counts issued application backing attempts;
transport/pool failures can occur before DB admission. Cache misses, issued fetches,
admitted DB work and commits therefore have distinct populations.

Conservation includes caller partition, station admission/terminal/live partition,
session idle/active totals, transaction live/commit/abort/cancel totals, compatible
lock ownership, CPU work within available core-time, attempted lookup hit/miss/
failure/cancel/live partition and entry byte budget. Entry observations distinguish
expired allocated bytes from logically live entries. Observation itself is pure.

`perf:data` records five 2,000-caller executor cases: ordinary queries, 100,000-key
inventory, expirations, stampede and locks. Local measured execution was roughly
0.3–1.2 seconds per case; the large inventory required about 0.94 second setup,
0.86 second evidence aggregation and 0.26 second serialization. The stampede case
committed 64 duplicate backing queries for one absent hot key. Values are one local
sample under variable GC/interference, not gates or PG/Redis throughput estimates.
Lazy expiry creates no per-key recurring timer. LRU uses map order; lock release
visits owned keys rather than every held key. Full large-state evidence remains an
identified cost, not hidden behind a fixed health percentage.

Final acceptance requires frozen install, all workspace typechecks/lint/tests,
boundaries, tooling, Reality and every calibration/proof replay, Model-1 goldens,
ten challenge hashes, web build, audit, integration and exact-SHA Actions/external
status inspection. Actual final counts/SHA/statuses belong in the completion report;
do not predict CI results in this document. No schema/runtime release change is
introduced; the existing packaging CI still exercises its normal rehearsal.
