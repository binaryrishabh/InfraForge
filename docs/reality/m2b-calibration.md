# Demand profiles and measured calibration

All profiles are internal source-controlled candidates. No profile activates Free
Mode, changes Model 1 or certifies a cloud SKU. [Research](m2b-research.md) supports
the methodology; the following measurements support only their named workload.

## Contract and fitting

`infraforge-demand/1` identifies application, operation, resource stage, version,
units, acquisition method, evidence/date, exact labels, bounded context dimensions,
uncertainty and Free Mode policy. Methods distinguish measured, derived-measurement,
fitted, bounded, synthetic and unknown. Bounded/Unknown demand cannot execute as a
point demand. No midpoint or random sample is silently substituted.

Bindings resolve exact software/environment labels and quantity-unit/range checks.
Workers/cores come from station configuration, overriding potentially misleading
context claims. Trace payloads must also fit the relevant profile bounds. Outside
the declared domain, resolution returns Unknown and execution refuses the scenario.
Validity dimensions are application-specific, not one global hardware schema.
Metadata is an explicit claim supplied with provenance; the resolver cannot prove
that an external measurement or host label is truthful.

`infraforge-benchmark/1` preserves record/run identity, split, application/operation,
software/environment, date/provenance, operation/configuration details, warmup,
operation count, process CPU core-us, wall-us, stated CPU resolution and limitations.
Serial batches have one operation class and no external offered-load generator;
batch throughput is derivable from operations/wall time. Per-request response
observations and authored offered load live in the separately recorded trace runs.
Missing power state, isolation, temperature, background load and frequency control
remain unknown. No measurements of those conditions were fabricated.

The fitter estimates one conditional mean:

```
D_cpu(operation) = sum(fitting batch process CPU core-us) / sum(fitting operations)
```

It does not fit throughput, a latency constant or a queueing formula. It validates
record identity/context/count/units/resolution and disjoint fit/holdout run IDs.
At least two fitting and two held-out batches are required. The observed fitting
batch-mean range is descriptive, not a confidence interval. Error outputs include
MAE/RMSE core-us, mean/max absolute relative error and residuals. Held-out values
cannot change the fitted demand. Tests deliberately corrupt holdout observations
to prove that the fit is unchanged while error becomes large.

## Reproduce and inspect

```
bun run check:calibration       # replay committed observations and verify report
bun run measure:workload        # remeasure THIS host, replace versioned local artifacts
bun run debug:workload          # inspect overload/pause/cancellation mechanism proofs
bun run perf:workload           # descriptive executor performance, separate artifact
```

Remeasurement deliberately changes source-controlled observations. Different source,
runtime, environment or methodology requires reviewing the profile version/domain;
it is not evidence that an old candidate applies to the new environment. The source
hash is checked against the measurement manifest. No external dataset/license is
needed: the benchmark and its generated records belong to this repository.

The controlled application is Node PBKDF2-SHA256 with fixed public 64-byte input,
16-byte salt, 32-byte result; LIGHT performs 8,000 iterations, HEAVY 64,000.
Eightfold algorithm work is an authored operation definition, not an RPS multiplier.
Each class has 12 batches of 64 operations, with 16 excluded warmup operations per
batch. Operation order alternates. Every third batch is preassigned to holdout:
8 fit + 4 holdout batches/class, 512 fit + 256 held-out operations/class.
The trace process warms both operations 32 times and executes a serial FCFS service.
One modeled core/worker is an analytical single-worker condition, not a pinned or
isolated physical core allocation. The CPU-only model sets blocking I/O to zero;
scheduler/dispatch overhead is not falsely fitted as I/O or network demand.

Host: AMD Ryzen 7 5700U, Windows 10.0.26300 x64, Node v24.15.0, OpenSSL 3.5.5.
This is a host-specific proof. CPU frequency, thermal/power state, process isolation
and background work were uncontrolled. Windows batch CPU resolution is conservatively
declared as 15,625 us. Batch averaging reduces quantization per operation but does
not reveal a per-request service-time distribution or establish steady state.

| Operation | Fitted core-us/op | Fit batch MARE | Held-out batch MARE |
| --- | ---: | ---: | ---: |
| LIGHT | 3,080.078125 | 4.85% | 5.13% |
| HEAVY | 23,500 | 0.60% | 2.45% |

Stored decimals reproduce the calculation; they do not imply measurement accuracy
at those decimal places. See [raw batches](m2b-measurements.json) and
[candidate profiles, ledger, errors and report](m2b-calibration.json).

## Held-out application traces

Twelve new traces contain 80 operations each: all LIGHT, all HEAVY, 90/10 mix and
50/50 mix, at three authored periodic arrival rates. The central interval is 9,968
us, selected from fitting means (0.75 × their average, rounded); the other rates
double/halve that interval. This targets an informative pressure range without
tuning on held-out latency. Total offered rates are approximately 50.16, 100.32
and 200.64 requests/sec. Profiles restrict authored periodic global intervals to
4,984–19,936 us; validation checks that the actual periodic/trace schedule matches
the context and refuses unsupported stochastic/closed or out-of-range use. These
three tested intervals do not establish continuous validity between them or validity
at other mixes, payloads, environments or transient thermal states.

All traces are fully authored before execution. A slow service does not suppress
later arrivals. The controlled service queue is sized for the bounded trace, so
there are no hidden admission drops. Real response time starts at the intended
relative arrival timestamp, including late dispatch. The generator may wake late
on Windows; that discrepancy remains in the result. Model results are compared
by authored identity, with a common arrival-window cutoff and a separate full drain.

| At the same 100.32 offered RPS | Window completions model / measured | Model queue at cutoff | Model / measured mean response (ms) |
| --- | ---: | ---: | ---: |
| LIGHT | 80 / 80 | 0 | 3.08 / 9.17 |
| HEAVY | 33 / 33 | 46 | 558.01 / 572.08 |
| 90% LIGHT / 10% HEAVY | 79 / 79 | 0 | 6.89 / 13.13 |
| 50% LIGHT / 50% HEAVY | 59 / 59 | 20 | 146.23 / 158.60 |

All 12 measured/model traces drain 80 outcomes. Window completion counts happen to
match in all 12; that is one observed comparison, not a general error guarantee.
The report preserves per-scenario MAE/RMSE, means, empirical median/p95 and CPU
counter discrepancies. With 80 responses, p99 is Unknown under our reporting rule.
Raw results and authored traces are in [m2b-heldout-traces.json](m2b-heldout-traces.json).

## Discrepancy and external validity

The constant-demand model underpredicts low-load latency materially (about 6–8 ms
mean bias in LIGHT traces). Busy HEAVY/mixed traces also have residual error; queueing
can amplify small demand bias. We did **not** add an arbitrary offset to hide it.
OS wakeup/dispatch delay, frequency changes, process overhead and service variation
are plausible contributors, not separately measured causal diagnoses.

One low-load trace returned a **zero process CPU delta despite completed CPU work**.
The raw value is preserved, its comparison is explicitly Unknown, and no division,
zero-demand inference or NaN/Infinity serialization is allowed. Other trace process
CPU counters include dispatcher overhead and are not isolated service CPU accuracy
measurements. The batched CPU fit/holdout results remain separate from this issue.

Software verification, calibration fit, held-out batch accuracy, held-out response
accuracy and external validity are different claims. This exercise proves a working
measurement-to-candidate-to-model-comparison pipeline. Its mean-demand candidates
have a narrow declared host/software/warm/worker/payload domain, are not accepted as
general latency predictors, and have **no AWS/DigitalOcean or production validity**.
Additional repeated independent runs/environments and workload-specific service
variation would be needed before stronger claims.
