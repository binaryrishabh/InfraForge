# M2E internal data plane

Select `resolveModel("2", { internal: true, workloadVersion: "m2e/1" })` or import
the internal data runner. The internal default remains M2D for compatibility.
Model 1 remains the sole published model. No browser/runtime export, endpoint,
schema migration, UI change, activation switch or provider mapping is added.

`data/contracts.ts` owns the relational, cache and cache-aside configurations.
`data/run.ts` composes them through the existing M2B lifecycle and M2D paths;
`database.ts`, `locks.ts`, `cache.ts` and `aside.ts` own separate state machines.
The compute resource factory is a narrow extension seam. Data modules use M2C's
CPU scheduler directly; they never run the old generic database station.
The `execution` envelope supplies CPU cores and cache command queue capacity to
the adapter. Generic workers/profiles do not create extra data execution slots:
DB admission and serial cache execution own those limits. The coordinator is a
logical application policy with no separately invented CPU demand. Generic quota,
memory enforcement/complete-memory claims and downstream settings are refused;
data processes retain partial/Unknown resident memory. Data resources are omitted
from generic compute configuration evidence.

## Ownership and lifetime

| Owner | State and bound |
| --- | --- |
| M2B caller | Stable root/attempt identities, offered time, caller deadline and detached remote work |
| M2C application | CPU and workers held while dependent work waits |
| M2D path/pool | Request/response bytes, network queues, connection identity, serial or multiplexed leases, setup/acquire/response deadlines |
| Relational server | Persistent sessions keyed by delivered connection identity; idle/active partitions; server session ceiling |
| Transaction | Fixed statement program, admission slot, pending writes, result snapshot, timeout ownership |
| Lock manager | Shared/exclusive owners, FIFO waiters, actual wait-for dependencies and deterministic cycle victim |
| Cache | Serial command CPU/queue, entries, sizes, expiry, exact LRU, generations and flush epoch |
| Cache-aside application | Key selection, real child operations, optional coalescing, authored fallback/invalidation |

Relational connections have one stream. Session pinning permits one transaction
at a time; transaction admission is separately bounded by `activeTransactions`
and `pendingQueries`. Queued transactions already occupy sessions. Admission
slots stay pinned through statement locks/waits and committing. This explicit
policy does not claim PostgreSQL's full query admission scheduling.
Session registration occurs on first delivered DB operation, not TCP establishment;
pool connection establishment and server session allocation therefore have separate
evidence. Closing a transport connection aborts its live transaction and removes
the session. Lowering session capacity does not evict existing sessions.

Transactions move queued → lock/CPU/blocking wait → next statement → committing
→ committed/aborted/cancelled. Ordinary reads copy committed addressed rows at
statement start, including own staged changes. Writes/inserts take exclusive locks;
explicit locking reads use shared locks. Locks survive statement boundaries.
Successful commit atomically publishes staged versions; abort/cancellation drops
them. Missing reads return no row; update of an absent row changes no row; insert
requires authored bytes. Keys must belong to the bounded logical data set.

Actual locks produce waits. Deadlock detection includes held-owner and FIFO
dependencies; the requesting transaction that closes a cycle is aborted. Lock,
statement and transaction timeouts cancel owned events/CPU and release ownership.
CPU uses capped fluid shares. Blocking demand is explicitly application-specific.
Generated log bytes count staging, including writes later aborted; committed
logical writes count distinct keys per transaction. No physical log/device exists.

## Cache and application flow

Cycle or keyed-uniform selection addresses authored keys. There is no mutable
shared RNG and child identities are local to their parent call. Each lookup/fetch/
fill/invalidation travels over a distinct real M2D exchange. Request messages are
copied at delivery; response data becomes visible only after response transport
completes. Configured wire byte envelopes remain authored per operation, not a
RESP/SQL serializer or an automatic value-size-to-packet mapping.

Miss → DB query → returned row/version → cache SET → response. Fill is best-effort.
Cache failure either fails the caller or falls back to DB as authored; failure
fallback does not fabricate a fill acknowledgement. Coalescing is opt-in and local
to one coordinator. It shares the fetch/fill result; cancellation of a caller does
not erase detached child work. Followers may outlive their callers.

Capacity is value bytes plus authored overhead. Exact LRU moves accessed entries
to the end of the map; eviction removes the actual oldest entry. No-eviction can
refuse an allocation while old expired entries remain unreclaimed outside the
bounded expiry scan. This conservative behavior is explicit. Flush removes state
and changes the epoch. Process pause retains cache entries; combine pause and
flush to model state loss. Recovery warms through real accesses.

DB-success-then-invalidate can be disabled to demonstrate stale versions. Generation
tokens reject fills invalidated after their lookup. A write whose invalidation
fails still succeeds at the DB and records `write-invalidation-failed`. Commit and
invalidation are not atomic, so this is not a strong consistency guarantee.

## Faults, evidence and bounds

M2D service state controls availability/readiness; request blackholes are detected
by owning transport timeouts. DB process pause aborts active/queued transactions,
clears sessions and retains committed logical rows. Cache process pause aborts
commands while retaining entries. Dedicated interventions flush a cache, reduce
DB session capacity or alter actual DB CPU capacity for an interval. Generic data
CPU-percentage multipliers and unsupported cache-aside suspension are refused.

Evidence contains caller outcomes, application workers, network path/pool state,
sessions, transaction partitions and classes, statement phase, lock owners/waiters,
CPU work, reasons, reads/writes, log bytes, commits/aborts, cache entries/versions,
hits/misses/failures/cancellations/live lookups, fills, evictions and expiry removals.
Observation copies data and does not expire entries or perform service. Admission
slot occupancy and command busy time are actual time integrals.

Limits are in `data/policy.ts` with units/classification/provenance/scope/domain/
confidence/Free Mode policy. Logical keys, statements, keys per statement, sessions,
admission slots, interventions, terminal evidence and expiry scans are bounded.
M2B event/request/trace limits still apply before copying. Full row/entry snapshots
are bounded by 100,000 keys but expensive; future evidence pagination should preserve
ownership totals without presenting omitted state as absent.

Unknown: physical DB buffer hits, disk service, IOPS, fsync, log group commit,
replication, failover, recovery replay, full SQL/MVCC/index planning, Redis allocator
memory and active-expiry exactness, RESP pipelining, distributed cache consistency,
process GC and provider/SKU applicability. These require future mechanisms and
measurements, not reuse of synthetic proof constants.
