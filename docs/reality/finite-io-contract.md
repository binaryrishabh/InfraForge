# Finite keyed IO contract for slice 07b

Status: **proposal, not executable**. The structural schema is
`finite-io-contract.schema.json`; its proposed revision is
`postgresql-keyed-io/draft-1`. Slice 07a adds a measurement adapter and this
contract. It does not add a storage scheduler, change a relational plan, accept
this schema at runtime or activate Model 2. Historical `m2e/1` and
`postgresql-keyed/1` retain their existing meaning. Current statements supply
authored CPU, blocking wait and log bytes, and plans supply authored commit wait;
these are not a physical device model.
Sources: `packages/simulation/src/model2/data/contracts.ts:6`;
`packages/simulation/src/model2/data/contracts.ts:11`.

## Allowed future mechanism

One generation-scoped device owner must serve all attached relational roles and
explicit background work on the same simulation clock. It owns finite queued
operations **and** bytes, finite service concurrency, IOPS and byte throughput.
Its proposed FIFO policy reserves one shared operation/byte service calendar:
each operation's service demand is `max(1 / operationsPerSecond,
bytes / bytesPerSecond)` seconds. The owner starts a FIFO operation only when
both a concurrency slot and its shared service calendar are available; it advances
that calendar by the service demand and completes at start plus service demand.
A logical flush additionally consumes the
declared flush service time, including a declared zero-byte operation; its
meaning must be sourced. The flush occupies both the calendar and service slot
through that additional interval. Concurrency limits outstanding service; it never
multiplies the shared rate budgets. A more faithful split read/write/flush or
burst policy requires another explicit policy revision. These are authored
logical service semantics, not fitted PostgreSQL/device laws. This first policy
serializes service (a concurrency value above one grants no throughput gain);
07b should admit only concurrency one until a separately specified parallel
policy and its conservation tests exist.

Bounded keyed plans may supply an explicit ordered logical page sequence per
recorded key/range. A declared clean-page LRU owner has page size, initial pages,
finite capacity and a host memory reservation counted once. A buffer hit avoids
the declared read operation; a miss submits one page read and installs the page
only on completion. Exact LRU and explicit pages are **model assumptions**, not
PostgreSQL's replacement algorithm, optimizer or physical page discovery. Do not
map rows to pages by dividing payload bytes, or infer a hit ratio from an icon.
Each schema plan is a bound key/range instance; the future compiler must pin the
recorded key-to-instance mapping or extend the draft with finite binding tables.
The schema's ordered pages do not define a general key-to-page function.
Concurrent misses to the same page must have a declared single-flight policy in
07b and receipt accounting that prevents two installs or double-free; default
recommendation: coalesce one in-flight read, with independently cancellable
waiters. This detail is not encoded as executable behavior by this draft.

Keep CPU service, connection/pool waiting, DB admission, row-lock waiting, device
queue/service and commit acknowledgement as separate intervals and work owners.
Independent updates still take locks and can collide; hot-key serialization is
not IO delay. Reads and updates use the existing finite read-committed keyed
semantics. A declared local WAL acknowledgement charges explicitly supplied WAL
bytes/operations and flush work on the selected shared device. No implicit
group-commit savings or conversion of observed transaction latency into flush
time. Read-only plans have explicit zero WAL with provenance. Async/logical-only
acknowledgement must say which work can remain after caller success.

The first revision does **not** simulate dirty-page eviction, PostgreSQL WAL
record generation, page layout, recovery, crash durability, OS cache, optimizer,
checkpoints or autovacuum. Updates do not mutate a fictional clean-page cache
into a physical dirty cache. Background checkpoint/vacuum/page writes may only
enter as a separately bounded, sourced operation schedule on the same device;
otherwise mark their interference excluded/Unknown and qualify all totals.
This is an explicit demand replay model, not a complete storage engine.

## Required authoring and admission

Every supplied quantity needs units, source identity/revision, domain and
observed/authored provenance. Unknown is `value: null` with a reason; zero needs
an explicit, valid meaning and provenance. Structural validity does not grant
runtime admission. 07b must reject Unknown required demands or select a named,
reviewed assumption bundle with its own immutable identity. Never silently
substitute zero or use a measured aggregate as per-query work.

| Required input | Admission rule proposed for 07b |
| --- | --- |
| Device ID/generation, role placement and shared bindings | Unique owners; all references resolve; two roles on a device cannot spend independent capacity. Retire only when service, waiters and receipts settle. |
| Queue operation/byte capacities, concurrency, IOPS, bytes/s and flush demand | Finite positive capacities/rates; nonnegative sourced flush time; count/byte quantities are integers. Bound all simultaneous reservations. Refuse a request that can never fit; FIFO full queue has an explicit refusal outcome. |
| Page size, host buffer reservation/capacity, initial pages and page mapping | Positive integral page size/capacity, integral number of pages, unique initial pages within capacity, explicit finite mapping for every selected key/plan. Buffer owner and device must agree; partial host memory coverage remains Unknown. |
| Query CPU and lock/key plan | Keep CPU demand independently authored/observed and on its CPU owner; no regression from total PG cgroup CPU. Key/range bounds and isolation must match the finite plan; arbitrary SQL unsupported. |
| WAL bytes/operation count, device and acknowledgement mode | Explicit per-plan demand including sourced zero for reads. Nonzero declared WAL bytes require positive operation count. Writes cannot use read-only acknowledgement. Flush work is never free unless explicitly authored zero. |
| Background demand policy | Either bounded explicit schedule (including its bytes/operations/device/source) or excluded-unknown. The draft schema names this policy; 07b must add and validate the schedule payload before admitting that option. |
| Global page/receipt/background ceilings | Positive finite page/receipt ceilings; count and byte limits checked before materialization. Schema maxima are proposed software safety ceilings, not measured capacity. Runtime event/host budgets still apply. |
| Immutable evidence bundle and workload/domain | Capture exact input/profile/schema revisions, source hashes, key trace, warm/cold assumptions, device mapping and omitted mechanisms in the run record. No reuse as managed cloud calibration. |

## Work receipts and report invariants

07b should issue typed receipts containing device/generation, request/transaction
and operation IDs, class (`page-read`, `wal-write`, `flush`, `background-write`),
bytes/operation units, queue/service times, state and cancellation/commit phase.
Required invariants: accepted = queued + servicing + completed + cancelled before
service; byte and operation ledgers reconcile independently; started service is
accounted even if the caller detaches; no duplicate terminal receipt or resource
release; per-device shared budgets bound all roles and background work together.

Cancel before service removes queued demand once; cancel during service detaches
the waiter but retains already started work through completion. Before the
irreversible commit phase, rollback releases finite locks according to existing
PG semantics; after that boundary caller cancellation cannot erase committed
work. Preserve caller timeout and remote commit separately. 07b must specify and
test ordering of same-time completion, timeout, lock release and cancellation.
This draft does not locate every physical PostgreSQL commit subphase.
Sources for the existing protected commit/session semantics:
`packages/simulation/src/model2/data/database.ts:56`;
`packages/simulation/src/model2/network/transport.ts:30`.

Report queue/service/lock/CPU/pool intervals with their own populations, page
hits/misses, issued/completed/cancelled operations and bytes, WAL ack outcomes,
known memory reservation and omission/completeness flags. An overlapping wait
sample is not an additive duration. Unknown total demand, incomplete background
coverage or missing resident memory keeps the corresponding total Unknown.
No automatic timing promotion or Model 1 history relabelling.

## G4 evidence boundary and 07b acceptance

G4 uses pinned PostgreSQL 18, disk-backed Docker volumes, direct prepared pgbench
plans, read-committed single-statement autocommit and fsync/synchronous_commit on.
The adapter records plans with actual rows/buffers/WAL, settings, checkpoints,
autovacuum, pg_stat_statements, pg_stat_io, WAL, database, sampled activity/waits,
cgroup pressure/CPU/IO and shared Linux diskstats. The producer retains raw
artifact hashes, three repeats, a whole-concurrency holdout, failures and missing
counters. No measurement is automatically imported as an executable demand.
Sources: `scripts/reality/first-stack-pilots/g4-manifest.json:1`;
`scripts/reality/first-stack-pilots/g4-run.ts:1`;
`scripts/reality/first-stack-pilots/g4-summary.ts:1`.

The handoff must review observed buffer-fit relations, PG buffer-read counters,
WAL and sampled lock/IO waits against the retained summary. Physical disk latency,
per-query CPU, OS-cache residency, application pool waits, full resident memory,
managed durability/throughput and cloud tail accuracy remain Unknown. The
generator shares the laptop/VM storage; CPU limits/throttling and checkpoint/
autovacuum overlap confound service demand. Short windows and closed-loop load
cannot establish open-arrival overload, recovery or a capacity knee.

07b acceptance must cover two roles sharing one device; independent byte/operation
and concurrency limits; cached versus missing pages and finite eviction;
coalesced-read cancellation; hot locks independent of device delay; read-only
zero-WAL and nonzero write/flush work; background competition or explicit
exclusion; cancellation before/during IO and after irreversible commit; exact
boundary ordering; exhausted queues; Unknown/malformed inputs; replay identity;
historical outputs unchanged. Keep all timing assumption-only until a separate
reviewed calibration gate passes. No implementation is supplied in 07a.

UI needs only: review explicit page/device/buffer/demand assumptions and sources;
show separate pool/CPU/lock/device/WAL waits and populations; display buffer-fit
coverage, caller/remote-commit reconciliation, omitted background work and
Unknown totals; retain evidence/profile identity and unsupported reasons. No UI
design is included.
