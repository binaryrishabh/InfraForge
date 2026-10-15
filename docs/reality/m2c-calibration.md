# M2C measurement and calibration limits

See [research](m2c-research.md), [compute contract](m2c-compute.md), committed
[measurements](m2c-measurements.json) and [derived report/ledger](m2c-calibration.json).
These are local host-specific observations, not provider/SKU or general runtime facts.

## Campaign

The source-controlled Node worker-thread pool executes the known synchronous PBKDF2
LIGHT/HEAVY operations (8,000/64,000 iterations, SHA256, public 64-byte input, 16-byte
salt, 32-byte output). Each worker warms both classes eight times before measurement.
Startup is recorded and excluded from response/CPU windows. The operation creates no
application-level internal parallel tasks; scoped invocation parallelism is one.

Worker counts: **1, 2, 4, 8, 16, 32**, including oversubscription. Node reports 16 logical
processors/available execution contexts. Physical topology, SMT equivalence, affinity,
frequency, temperature, power and background interference are **Unknown/uncontrolled**.
Do not infer eight physical cores from the CPU model name or 16 independent physical
cores from the logical inventory.

Each homogeneous configuration has three 128-operation runs; two additional 128-job
90/10 and 50/50 mixes run per worker count. All jobs are authored simultaneous arrivals
before execution, then FCFS-dispatched to the pool. They are open bursts, not
completion-gated offered load or a steady-state RPS claim. Response starts at the
common intended offer and includes IPC/dispatch/queueing. Per-call wall service and
response, whole-process CPU, wall duration, achieved throughput and process memory
are preserved. Process CPU includes coordinator/runtime overhead; Windows resolution
is conservatively declared 15,625 us. CPU is not inferred from wall duration.

There are **48 runs / 6,144 operations**. Fitting uses only the first two homogeneous
runs at workers **1, 4, 16, 32** (16 runs / 2,048 operations). The third repetition,
mixes and **all 2-/8-worker runs** are held out (32 runs / 4,096 operations). Mixed
work and unseen configurations cannot influence fitted operation means.

## Conditional CPU points, not a smooth scaling function

Fit `sum(process CPU core-us) / sum(completed operations)` for each operation at each
fitting worker point. Counts are discrete exact domain restrictions. No interpolation
or generic contention multiplier is accepted. Unseen-worker numerical experiments use
an explicitly **unsupported transfer hypothesis**, average fitting-point CPU demand,
and a synthetic/approximation classification; they do not become calibrated profiles.

| Workers | Fitted LIGHT core-us/op | Fitted HEAVY core-us/op |
| ---: | ---: | ---: |
| 1 | 3,476.56 | 28,566.41 |
| 4 | 3,359.38 | 24,351.56 |
| 16 | 5,187.50 | 33,996.09 |
| 32 | 4,511.72 | 34,425.78 |

The differences reject a universal invariant service-demand claim. They do not
separately identify CPU contention, cache behavior, thermal drift, GC or frequency as
the cause. Small fitting repetitions and uncontrolled chronology constrain inference.
Stored full decimals reproduce calculation, not claimed precision.

Simulation capacity is an explicit **16 CPU-accounting-unit hypothesis**, with known
input provenance and invocation cap one, not a measured physical-core equivalence or
accepted host hardware mapping. Changes in conditional CPU demand and fluid sharing
can be compared without certifying that capacity hypothesis. No hardware capacity is
back-fitted to force throughput agreement. Discrepancies remain visible.

| Comparison | Cases | CPU MARE | Throughput MARE | Mean response MAE |
| --- | ---: | ---: | ---: | ---: |
| Fitting observations | 16 | 4.58% | 19.24% | 31.73 ms |
| All held-out observations | 32 | 9.54% | 12.74% | 31.52 ms |
| Held-out repetition/mix at fitting worker points | 16 | 8.17% | 15.98% | 33.52 ms |
| Unseen 2-/8-worker transfer hypothesis | 16 | 10.91% | 9.49% | 29.51 ms |

All 128 jobs drain in each modeled comparison. Good CPU fitting error does not imply
good response/scaling accuracy. These throughput/latency residuals are material; the
campaign does **not** validate the fluid capacity hypothesis as a physical scheduler
or establish general scaling. No automatic accuracy threshold promotes a candidate.
Software conservation verification, calibration fit, held-out comparison and external
validity are reported separately. All candidates remain internal and forbidden Free Mode.

## Measured scaling curve

Mean achieved operations/sec over the three homogeneous repetitions:

| Workers | LIGHT | HEAVY |
| ---: | ---: | ---: |
| 1 | 281.6 | 34.1 |
| 2 | 602.2 | 70.6 |
| 4 | 1,190.3 | 161.7 |
| 8 | 2,080.8 | 278.2 |
| 16 | 2,129.2 | 383.1 |
| 32 | 2,518.9 | 371.8 |

More workers do not imply proportional throughput, and the HEAVY mean declines from
16 to 32. These finite, warm, host-specific results are not steady-state guarantees.
No smoothed curve or universal SMT penalty was fitted. The original M2B single-worker
data are preserved, not rewritten to make this campaign agree.

## Service variation and memory proof

Per-call wall observations are real response evidence, but they include preemption,
queueing and IPC. Coarse aggregate CPU counters do not establish per-invocation CPU
variance. CPU service variation remains Unknown; no measured range becomes an RNG
distribution, and no p99 is derived from a mean. M2B empirical population floors remain.

Memory runs use 1/2/4 workers and 0/4/16 MiB touched Buffer allocations per worker,
retention acknowledgements, release, explicit GC where available, and RSS/heap/native/
ArrayBuffer snapshots. For example, four workers had baseline RSS 117,768,192 bytes;
64 MiB of explicit buffers raised observed RSS to 187,641,856; after release it was
120,582,144. Zero-byte cycles also change RSS. Shared/runtime/native/allocator state
and GC make exact component attribution non-identifiable from these observations.
The byte allocations and owner lifetimes are known; resident mapping is **Unknown**.
No precise baseline/per-worker/request RSS coefficients are fitted. Real candidate
compute replays therefore preserve partial/Unknown memory. Teaching footprints are
separately declared synthetic values and never presented as measured RSS.

## Reproduce

```
bun run measure:compute          # replaces THIS host's observations; review version/domain
bun run check:compute            # replay committed observations; verify derived artifact
bun run debug:compute            # synthetic mechanism proofs A–F plus pause
bun run debug:compute --write    # regenerate proof artifact
bun run perf:compute             # separate local executor timing artifact
```

The benchmark source hash is checked. No dataset licensing issue or external service
is involved. Different source/runtime/environment/methodology requires reviewing the
profile version and measuring afresh; metadata alone cannot prove an external claim.
