# M2E local measurement and rejected timing prediction

`data-benchmark.mjs` creates uniquely named/labelled, locally owned PostgreSQL and
Redis containers plus a dedicated network. Ports bind only to loopback. Each server
has a one-CPU container quota. PostgreSQL uses temporary tmpfs storage; Redis has
temporary storage with persistence disabled. No normal development database/cache
is touched. Label verification precedes fixture removal. The retained campaign
records successful cleanup, source hash, image identities, versions, Node/OS/CPU
and an environment hash. Re-running measurements is explicit, never part of CI.

`m2e-measurements.json` retains 60 DB batches / 7,680 operations and 54 cache batches /
6,912 lookups, including per-operation durations and pool acquisition waits. The
database table has 256 logical rows; eight closed issuers use pools of 1/2/4/8.
Five classes cover point read, 16-row read, independent update, hot update and a
two-statement transaction. Three repetitions are retained per configuration.
DB table versions evolve across batches; the workload class and key shapes remain
fixed. Ordered batches, background activity and Docker VM scheduling are limitations.

Fitting uses pools 1/4, repetitions 0/1: 20 batches. Holdout contains every pool 2/8
batch plus repetition 2 at fitting points: 40 batches, including 30 entirely held
out pool configurations. Ten discrete aggregate-CPU candidates use only fitting
container CPU deltas per completed operation. Deltas include background/monitoring
overhead; they do not identify true per-query CPU. Unseen-pool transfer is explicitly
unsupported and diagnostic. Query CPU is replayed through the real relational
executor, M2C scheduler and M2D client pool; injected setup/blocking/commit waits
are logical experiment inputs, not measured physical zeroes.

| Split | Batches | Throughput MARE | Response MAE |
| --- | ---: | ---: | ---: |
| Fit | 20 | 119.72% | 13,791.99 µs |
| Holdout | 40 | 69.41% | 8,104.44 µs |

**The complete DB/cache timing predictor is REJECTED.** Aggregate CPU is a conditional
surrogate and transport/runtime/storage costs remain unresolved. No offset,
network-latency adjustment or interpolation is introduced to reduce these errors.
These are finite batch errors, not statistical confidence bounds. Full results
remain visible in `m2e-calibration.json`, including unsupported held-out transfers.

Cache cases use value sizes 64/4,096/65,536 bytes, working sets 1/16/64, cold/warm
state and three repetitions. Each case performs 128 sequential GETs and a real SET
on miss. Fit has 16 batches; holdout has 38. The 4,096-byte value and 16-key set are
configuration holdouts. All 54 logical hit/miss sequences replay exactly through
the cache module. This is semantic validation, not fitted cache throughput.
The replay's one-CPU-microsecond logical clock and zero injected overhead are
synthetic scheduling inputs; Redis command CPU and physical memory overhead remain
Unknown. No Redis wall-time predictor is accepted or invented.

Separate real semantic observations confirm that an ordinary read returns while
a writer holds its row, a conflicting update reaches `55P03` lock timeout, rollback
releases ownership, and a Redis key is present before TTL and absent after expiry.
The wall observation does not locate the exact Redis expiry instant.

Replay validates source/environment/identity/splits, complete operation populations,
cleanup and artifact equality. Tests alter only held-out timings and confirm fitted
candidates do not change; split drift is rejected. Reality ledger entries preserve
units, classification, provenance, domain, confidence and forbidden Free Mode policy.
No result certifies managed databases, cloud hardware, provider SKUs or production
performance. M2D's separately rejected 1,488.57% host-network MARE remains rejected.
