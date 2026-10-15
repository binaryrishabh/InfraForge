# M2B workload research and decisions

Researched 2026-10-15. These sources support mechanisms and methodology, not the
numeric demand of an arbitrary application. The local measurements have their own
provenance. Model 1 remains active; all new work is internal.

| Primary source | Conclusion used here | Boundary / rejected approach |
| --- | --- | --- |
| Schroeder, Wierman, Harchol-Balter, [closed versus open systems](https://www.cs.cmu.edu/~harchol/Tools/Notes/papers/nsdi06.pdf) | External arrivals and completion-gated users are different workload models. Both are implemented. | A slow response must never delay the next *open* arrival. Closed users gate on caller outcome plus think time; detached remote work can outlive that user interaction. |
| Gil Tene, [wrk2 methodology](https://github.com/giltene/wrk2) | Preserve intended arrival times when measuring overload. | No deletion of arrivals because the real dispatcher woke late. The controlled benchmark includes dispatch lateness in observed response time. This does not prove the dispatcher is an ideal traffic generator. |
| Google SRE, [handling overload](https://sre.google/sre-book/handling-overload/) | Bound queues and concurrency; overload emerges from retained work and demand. | No CPU-threshold-to-failure rule. Admission and queue occupancy are mechanisms, not decorative metrics. |
| gRPC, [deadlines](https://grpc.io/docs/guides/deadlines/) | A caller's time budget and server activity have different ownership. | A remote service does not automatically obey the caller's deadline. M2B has caller deadlines, not an invented universal server timeout. |
| gRPC, [cancellation](https://grpc.io/docs/guides/cancellation/) | Server handlers must cooperate to stop computation; propagation depends on implementation. | Cancellation is an explicit station capability. M2B's cooperative cancellation is ideal and instantaneous, not a claim about real gRPC acknowledgement latency. |
| PostgreSQL, [query cancellation](https://www.postgresql.org/docs/18/libpq-cancel.html) | Sending a cancellation request does not establish that a query was actually cancelled. | Database work can continue after parent cancellation. No assumption that a database query is interruptible because its client disappeared. |
| Amazon Builders' Library, [timeouts, retries, backoff and jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) | Retries add load and can amplify overload; retry policy belongs to an owning caller. | No universal retry/backoff policy. Attempt identity is separate from root identity; retry execution is deferred. |
| Amazon Builders' Library, [idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | A missing response does not establish absence of side effects. | Operation idempotency is explicit metadata, including Unknown. It is not permission to retry automatically. |
| AWS, [exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) | Correlated retry timing matters independently of average retry count. | Future jitter must be keyed by root/attempt/purpose. No shared RNG stream or unqualified performance multiplier. |
| W3C, [Trace Context](https://www.w3.org/TR/trace-context/) | End-to-end identity and parentage are separate concepts. | Internal tuple identities preserve root, attempt and child-call relationships. They do not claim W3C wire-format compliance or provide tracing infrastructure. |
| Node.js, [CPU usage and high-resolution time](https://nodejs.org/docs/latest-v24.x/api/process.html) | Process CPU core-time differs from elapsed wall time; monotonic elapsed time is suitable for duration measurement. | CPU batches fit CPU demand. Observed latency remains a distinct response measurement. Windows counter resolution/invalid zero deltas are disclosed. |
| Node.js, [PBKDF2](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptopbkdf2syncpassword-salt-iterations-keylen-digest) | A reproducible CPU operation can vary explicit algorithm work via iteration count. | The benchmark is a controlled application operation, not advice about password storage or a general HTTP workload. Fixed public fixture bytes contain no secrets. |
| SPEC, [run/reporting rules](https://www.spec.org/cpu2017/Docs/runrules.html) | Disclose software, configuration, execution conditions and measurement procedure. | This is our own benchmark; no SPEC results, certification or restricted dataset are copied. |
| SPEC, [benchmark overview](https://www.spec.org/cpu2017/Docs/overview.html) | Benchmark representativeness depends on the actual target workload. | No cloud SKU or universal application throughput follows from this host-specific crypto workload. |
| NIST, [least squares](https://www.itl.nist.gov/div898/handbook/pmd/section1/pmd141.htm) | Begin with a small identifiable model, inspect its errors. | Fit one conditional mean CPU demand per operation. No high-order response surface, hidden latency offset or holdout-driven tuning. |
| NIST, [model validation](https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd44.htm) | Fitting error alone does not establish model adequacy; residual structure matters. | Keep fitting batches, held-out batches and held-out trace responses separate. A zero error against analytical fixtures is software verification only. |
| NIST Dataplot, [percentile conventions](https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/percenti.htm) | Quantile conventions differ and must be stated. | Use empirical nearest rank, without interpolation. The minimum tail sample rule is an explicit internal reporting policy, not a statistical confidence theorem. |
| Prometheus, [histograms and summaries](https://prometheus.io/docs/practices/histograms/) | Bucketing introduces quantile uncertainty. | Return an interval for a histogram-derived rank, never a fabricated point estimate. Separate operation/outcome populations. |
| HdrHistogram, [bounded histograms](https://github.com/HdrHistogram/HdrHistogram) | Dynamic range, precision and memory are explicit engineering choices. | M2B uses a simpler 54-bucket log2 layout and reports its wider intervals; it does not copy HDR's precision claim or code. |
| Maricq et al., [Taming Performance Variability](https://www.usenix.org/conference/osdi18/presentation/maricq) | Host variability affects reproducibility and experimental interpretation. | One host's timings are descriptive. No confidence interval is invented from adjacent batches or one timing run. |
| Barrett et al., [VM warmup](https://arxiv.org/abs/1602.00602) | A fixed warmup count does not prove steady state. | Warmup counts and alternating operation order are recorded. These runs are finite warm experiments; no stationarity certification is claimed. |

## Workload characterization

Work is described by arrival timing, stable operation class, payload scope, demand,
dependencies, caller ownership and the operating environment. Mean RPS alone loses
mix, burstiness, serial correlation and service-time variability. Periodic arrivals
are authored schedules. Poisson arrivals use independent keyed exponential gaps,
quantized upward to at least one microsecond; they are an explicit idealization,
not a statement about real traffic. Bursts/correlation can be authored in traces.
Do not turn an epistemic demand interval into a probability distribution.

Closed populations currently issue one operation per source and one outstanding
caller interaction per user, with finite per-user budgets. Full login sessions,
state-dependent operation transitions, user abandonment distributions and partly
open sessions were researched but are deferred. Trace-driven open arrivals and
explicit operation sources already represent mixes without imposing one mix law.

Little's law and utilization laws are useful checks only over compatible populations,
time intervals and assumptions. M2B verifies deterministic FCFS cases directly; it
does not apply steady-state M/M/1 formulas to finite queues, faults, heterogeneous
jobs, censored runs or the controlled transient traces. Warmup is excluded from CPU
fitting batches, while finite trace response populations explicitly include their
initial transient and drain. Fitting a steady-state queue formula to those traces
was rejected.

## Rejected shortcuts

No RPS-per-vCPU constant; no CPU demand inferred from provider core count; no fake
network offset; no fitting a queueing delay as CPU time; no hidden validation split;
no random draw from a knowledge bound; no automatic cancellation cascade; no
per-resource-pair fault multiplier; no silent histogram truncation; no automatic
profile publication after a good fit. Unmeasured resource working sets, network,
locks, storage devices, retry side effects and remote cancellation protocols remain
outside this milestone. See [calibration limits](m2b-calibration.md).
