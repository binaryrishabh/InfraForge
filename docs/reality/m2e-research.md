# M2E research and decisions

Researched 2026-10-15. This is an internal mechanism profile. PostgreSQL and Redis
inform selected semantics; neither product is simulated completely. Sources below
are primary documentation. Numeric performance comes only from the retained local
campaign, with its exact software and environment fingerprint.

## Sessions, admission and execution

Server connection capacity is a separate resource from transaction throughput.
PostgreSQL reserves server resources according to connection settings; a larger
connection ceiling does not imply faster queries. M2D pools therefore remain on
the client side, while M2E owns persistent server session identities, a server
session limit, transaction admission slots and a pending transaction queue.
One statement executes per transaction at a time. Admission remains pinned during
locks, application-specific waits and commit acknowledgement. This is a deliberately
bounded admission policy, not a PostgreSQL scheduler emulation.
[PostgreSQL connections](https://www.postgresql.org/docs/18/runtime-config-connection.html).

Pool acquisition and connection setup deadlines belong to transport; statement,
lock and transaction deadlines belong to the relational executor. PostgreSQL's
statement timeout includes server command handling, whereas M2E starts it when a
statement enters execution after transaction admission. M2E transaction timeout
includes admission waiting and aborts the transaction without killing its session;
PostgreSQL's transaction timeout terminates the session. These differences are
intentional and exposed rather than hidden behind product terminology.
[PostgreSQL timeout definitions](https://www.postgresql.org/docs/18/runtime-config-client.html).

## Logical data, isolation and conflicts

Read Committed inspired the smallest useful behavior: each ordinary read copies
the committed versions of its explicitly addressed keys at statement start, with
its own staged changes visible. A later statement may see newer committed data.
Ordinary reads acquire no row locks. A waiting writer observes the current version
after acquiring its lock. This handles fixed-key version increments, not arbitrary
predicates, phantom prevention or full SQL/MVCC storage. Repeatable Read,
Serializable, SSI, tuple chains, vacuum, index visibility and predicate rechecks
are deferred. [PostgreSQL isolation](https://www.postgresql.org/docs/18/transaction-iso.html).

Exclusive write/insert locks and explicit shared locking reads retain ownership
until commit or abort. Real queues create waiting. FIFO dependencies join held-lock
dependencies in the wait-for graph, including lock upgrades. A newly requesting
transaction that closes a cycle becomes the deterministic victim. PostgreSQL has
more lock modes and different detection/victim details; M2E makes no equivalence
claim. Abort discards staged writes and releases ownership. Random deadlocks and
fixed contention penalties were rejected.
[PostgreSQL locking and deadlocks](https://www.postgresql.org/docs/18/explicit-locking.html).

Point operations address one key; a bounded explicit key list expresses a logical
range. Insert requires authored row bytes, update changes a logical version, and
a transaction is a bounded statement program. There is no arbitrary SQL parser,
index planner, B-tree cost formula or universal QPS conversion. CPU demand is
operation-specific and uses M2C scheduling. `blockingWait` is an authored workload
wait, never an inferred SSD service time.

## Storage, buffers, durability and recovery

Database buffer hits require page/cache identities, a storage path and credible
measurements. PostgreSQL distinguishes activity and I/O observations, and timing
instrumentation itself has costs. M2E has a logical data set but no page model;
buffer hits, IOPS and device latency remain Unknown. A range's CPU demand must be
authored/measured for that application rather than inferred from its key count.
[PostgreSQL statistics](https://www.postgresql.org/docs/18/monitoring-stats.html),
[timing instrumentation](https://www.postgresql.org/docs/18/runtime-config-statistics.html).

Real WAL orders log durability before data-page persistence. M2E records authored
log bytes when a write statement stages changes and offers logical commit or an
explicit authored log-acknowledgement wait. Only the latter sets the modeled
durable acknowledgement flag. This flag describes the configured abstract path;
it does not establish device persistence or crash recovery. Group commit, log
devices, fsync, torn writes and checkpoint replay are future mechanisms.
[WAL](https://www.postgresql.org/docs/18/wal-intro.html),
[commit/fsync settings](https://www.postgresql.org/docs/18/runtime-config-wal.html).

Replication introduces independent send/write/flush/replay progress, synchronous
acknowledgement choices, replica read state and promotion/recovery behavior.
M2E deliberately adds none of their timing or availability guarantees. A process
outage aborts live modeled transactions and clears sessions, while retaining the
logical committed data. Resumption accepts new work; it is not failover, storage
recovery or a read-replica model.
[PostgreSQL standby architecture](https://www.postgresql.org/docs/18/warm-standby.html).

## Cache state and policies

An entry owns a key, logical version, value bytes and an absolute virtual expiry.
Authored per-entry overhead contributes to the entry budget; allocator/process
resident memory remains Unknown. Exact LRU uses real access order. No-eviction
refuses capacity-increasing writes. Redis uses sampled approximate LRU and has
memory exclusions; M2E's exact policy and byte budget are narrower abstractions.
LFU would require access-frequency/aging state and random eviction a keyed choice;
neither improves this first proof enough to justify implementing it now.
[Redis eviction](https://redis.io/docs/latest/reference/eviction/),
[memory representation](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/).

Expiry is a virtual-time comparison, never a probability. Lookup removes an expired
entry before deciding hit/miss. Writes inspect a bounded cursor of 64 entries for
expired state; pressure then removes actual LRU entries. Expired but unreclaimed
entries remain in allocated bytes and cannot hit. No recurring timer is allocated
per key. Redis combines passive and active expiry; this bounded lazy strategy is
an explicit executor policy, not its exact algorithm.
[Redis EXPIRE](https://redis.io/docs/latest/commands/expire/).

The chosen application pattern is cache-aside: lookup, real backing query on miss,
best-effort population and response. Read-through would move backing-fetch ownership
into the cache service; write-through would require coordinating successful cache
and database writes; write-behind needs a durable pending-write queue and recovery
semantics. Those alternatives are deferred, because they create different failure
contracts. Cache-aside consistency and invalidation require authored application
policy; a cache is not automatically authoritative.
[Microsoft cache-aside pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside).

DB-success-then-invalidate is optional. Entries preserve versions so stale data can
be distinguished from fresh data. Key generations plus a flush epoch refuse a
fill whose lookup preceded a completed invalidation/flush. This does not make the
DB commit/invalidation interval atomic, prevent every stale response or provide
distributed linearizability. Failed invalidation is recorded; write success still
reports the database result under this explicit best-effort application policy.

Simultaneous misses normally generate separate backing operations. Opt-in
per-application, per-key coalescing lets one owner fetch/fill while followers wait
for that result. It changes actual calls rather than multiplying a hit rate.
Cross-process coalescing, distributed leases and write/fill ordering across
coordinators remain unsupported.
[singleflight duplicate suppression](https://pkg.go.dev/golang.org/x/sync/singleflight).

## Measurement alternatives and rejected shortcuts

The local campaign controls pool size, query class, value size, working set and
warm state. Closed eight-issuer database batches keep callers distinct from server
connections. Cache observations use one sequential connection, so they cannot
identify multipipelined throughput. M2D stream leases can express concurrent cache
calls, but this is not RESP packet batching. Redis benchmarking guidance explicitly
distinguishes those dimensions. PostgreSQL benchmark guidance likewise separates
clients, connection overhead and query scripts.
[Redis benchmarks](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/benchmarks/),
[pipelining](https://redis.io/docs/latest/develop/using-commands/pipelining/),
[pgbench](https://www.postgresql.org/docs/18/pgbench.html).

Rejected alternatives: QPS-per-vCPU, connection-count-as-throughput, universal
database stations, every-read-locks-writes, invented SSD latency, fixed cache hit
ratios, fault CPU multipliers, random deadlocks, invisible warm recovery, fitting
on held-out samples and network residual correction. Separate resource modules
and explicit Unknown values leave storage, replication and messaging extensible.
