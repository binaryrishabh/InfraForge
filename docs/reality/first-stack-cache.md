# Internal recorded-key cache composition

`infraforge-first-stack-sidecar/3` / `first-stack-compiler/3` is an explicit
reviewed cache-enabled copy. V1 remains authoring-only; V2 remains cache-free.
The public dispatcher is unchanged, Model 1 remains active, and timing stays
assumption-only. Full resident memory and full cost remain Unknown.

Each app retains one compute/worker owner. Operation routing sends cache reads
and invalidating writes to its owned `app/cache-policy` role. Other reads and
the separately identified health operation go directly to the DB. The policy
has no host CPU/memory lease. Optional explicit policy CPU is added to app demand
once for cache-mediated operations. Null policy CPU stays labelled Unknown;
the policy introduces no implicit measured overhead coefficient.

Canvas app→cache edges bind the app-owned policy's cache path. The reviewed
sidecar separately declares compute→policy and policy→DB paths and directed
links, including bytes and independent finite serial pools. The original
app→DB path is retained for health/direct reads. These separately authored link
capacities are independent; co-located identities do not imply shared physical
bandwidth. Shared physical bottlenecks require an explicit future link profile.
Internal paths are byte/queue bounded and included in preflight. The complete
cache profile is part of workload identity and compile locking.

Every cache read and write uses the actual recorded point key. Cycle/uniform
fallback is forbidden on these policy roles. A GET hit saves an actual backing
read; a miss traverses a real policy DB path and then SETs the returned row with
the GET generation token. Successful write completion starts a new coalescing
generation and invalidates the key. An older fill cannot delete the newer
coalescing group or resurrect invalidated cache state. A read already in progress
may return its earlier read-committed snapshot; this is not linearizable caching.
Policy results retain exact key, root, source, completion and available version.
Writes do not invent a row version when the DB acknowledgement omits it.

Fallback/fail policy, capacity, explicit entry overhead, initial keys, TTL,
exact LRU/no-eviction and coalescing are reviewed inputs. Exact simulated LRU
is distinct from sampled Valkey LRU. Entry accounting is not full process memory.
Saved logical DB reads are hits plus coalesced waiters, not a fixed hit-rate
constant or a physical DB time/cost estimate. Per-app coalescing is not a
distributed lock. Policy cancellation remains unsupported; detached work can
complete after caller termination. Generic fault/retry extensions are separate. Cache plus the newly merged finite
IO profile requires a separately reviewed composition revision and is explicitly
refused; the existing cache-free finite IO path is preserved. The merged
isolation boundary remains authoritative for isolated execution and replay.

Semantic proof and targeted verification:

```powershell
bun --no-env-file scripts/reality/first-stack-cache-proof.ts --write
bun --no-env-file scripts/reality/first-stack-cache-proof.ts
bun --no-env-file --no-install test scripts/tests/first-stack-cache.test.ts
```

The proof pins 12 cache graphs across 1/2/8 apps, warm/cold and coalescing on/off,
including observer equality. Tests additionally cover expiry, exact LRU,
no-eviction rejection, fallback/fail, write invalidation, stale fill/new-read race,
CPU charged once and refusal of stale identities/Unknown transport bytes.
The G7 local producer and record are described in
`scripts/reality/first-stack-pilots/G7.md`; CI never runs measurements.

UI needs only: reviewed profile upgrade and role/path ownership; exact recorded
keys and workload identity; hits/misses/fill acknowledgement/refusal; coalesced
waiters and actual logical backing reads; TTL/entry bytes/eviction policy;
caller result alongside late work and invalidation status; Unknown policy CPU,
full memory/cost and assumption-only timing. No UI design is included.


Regenerate the exact cache source receipt with
`bun --no-env-file scripts/stage2-cache-identity.ts --write` after reviewing the
six mechanism deltas. Re-pin changed source/acceptance files in the first-stack
review and preserve matching slice capability reviews. Regenerate cache,
compile/bounds and historical host proofs with their own producers. Run
`scripts/refresh-execution.ts --baseline=<full main commit> --review="<scope>"`
last after source/test/doc changes and exact-source capability review. This
preserves the accepted historical sources and adds one reviewed main transition;
it does not replace the original 88-file baseline or eight replay hashes.


The next transition after the isolated main release uses
`isolation-boundary/1`. Its frozen eight-entrypoint reconstruction and full
syntax policy reproduce main's retained descriptor exactly. The earlier
`analysis-boundary/1` algorithm remains unchanged and continues to reconstruct
older snapshots. The refresh producer accepts a reconstruction algorithm only
when its complete descriptor digest equals the already pinned baseline source;
missing sources, changed host bytes, unknown algorithms and inconsistent
snapshots remain refused. The dedicated historical-isolation test reconstructs
without Git and rejects missing or altered isolated hosts.
