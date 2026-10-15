# M2D controlled loopback measurement

The committed campaign is a calibration-pipeline experiment, **not an accepted complete
network predictor**. Its substantial residuals are retained. No cloud/WAN/ALB/NLB/HTTP
capacity, RTT or universal latency value is inferred.

## Procedure and applicability

[network-benchmark.mjs](../../scripts/reality/network-benchmark.mjs) creates temporary
`127.0.0.1` TCP servers/clients on ephemeral ports and closes all owned sockets after
each observation. It uses a framed echo protocol with an eight-byte application header,
asymmetric response payload (twice request payload), `setNoDelay`, a serial request per
connection and independent whole-message FIFO JS timer pacers per direction. The pacer
delay is authored bytes/configured rate. TCP/kernel/runtime costs and timer dispatch
remain in the observations. The pacing rate is not measured physical link bandwidth.

Host: owner-local Windows 10.0.26300 x64, Ryzen 7 5700U, Node v24.15.0. The host/config
hash and exact LF-pinned source hash are retained in
[m2d-measurements.json](m2d-measurements.json). Source hash:
`56a4465038921f98cb54935741efb306a458291058d0dda581c56649c97d7ceb`.

One unretained 32-operation run warms framing/socket/pacer paths. There are 30 retained
configurations, three repetitions each: **90 batches / 2,880 completed operations**.
Each batch has 32 closed-loop operations. Main configurations use eight client issuers,
pools of one/four connections, persistent/non-reuse policies, 64/4,096/65,536-byte request
payloads and 1,048,576/4,194,304 bytes/s authored pacing. Additional held-out cases use
four issuers/two connections at 1,048,576 bytes/s. All connections are loopback; there
is no database, cloud resource or persistent service.

Retained fields include payload/framing bytes, operation identity, response/offered
time, wall time, achieved throughput, connect-event durations, created/accepted
connections, aggregate process CPU, software/environment and split. A 30-second
per-batch wall guard bounds hung observations; this is a harness safety limit.
Timing clocks are monotonic high-resolution readings, not a guarantee of dispatch
precision. Batches run sequentially; adjacent repetitions do not establish statistical
independence or stable temperature/load. Socket/data buffering and parsing overhead
are included, not measured separately.

## Fit and held-out populations

**32 fitting batches / 1,024 calls**: repetitions zero/one at 16 discrete configurations
with payloads 64/65,536, one/four connections, eight issuers, both pacing rates and
both reuse policies. Each candidate is the ceiling of mean observed socket connect
duration using only those fitting rows. It includes runtime scheduling, not just TCP
establishment. Exact source/environment/configuration restrict applicability.

**58 held-out batches / 1,856 calls**: the third repetition at fitting configurations
(16 batches), all 4,096-byte configurations, and all two-connection/four-issuer cases.
The latter 42 batches have wholly held-out configurations. No established point is
silently interpolated. Numerical replay outside fitted points uses an explicitly
unsupported mean-establishment transfer hypothesis and creates no accepted candidate.

The comparison runs the actual Model-2 link and pool primitives with the same known
framed bytes, client concurrency, connection policy and authored directional pacers.
It has explicit zero **injected logical** propagation and an immediate logical echo,
not measured zero physical propagation or endpoint overhead. It never adds a residual
latency constant to match the host. All 32 jobs and both directional application-byte
totals reconcile in every comparison. Handshake/TCP/IP overhead is not claimed.

## Results and rejection

| Population | Batches | Throughput MARE | Response MAE |
| --- | ---: | ---: | ---: |
| Fitting | 32 | 3,525.42% | 116.73 ms |
| Held out | 58 | 1,488.57% | 86.63 ms |

Across all repetitions/configurations by request payload:

| Payload | Batches | Throughput MARE | Response MAE |
| ---: | ---: | ---: | ---: |
| 64 bytes | 30 | 6,364.30% | 110.08 ms |
| 4,096 bytes | 30 | 256.02% | 88.11 ms |
| 65,536 bytes | 30 | 18.03% | 93.80 ms |

These are mean absolute relative errors, so a 1,488.57% error is not 14.89%. The model
strongly overpredicts small-message throughput. Timer/runtime/socket scheduling is
outside the ideal serializer. Payload-dependent residuals are consistent with that
omission, but the campaign does not identify a unique causal decomposition or a
portable correction. Even large-message results do not certify physical link capacity.

The complete networking predictor is **rejected for this host/runtime pipeline**.
Conditional connect-event observations remain research candidates, forbidden from
Free Mode. Physical bandwidth, propagation, timer/dispatch cost and protocol overhead
remain Unknown. No fitted universal curve, default RTT or selected favorable subset
is promoted. This negative result is separate from software conservation correctness.

The artifact stores every comparison, candidates, disjoint fit IDs, input quantities,
implementation guards, Unknown entries and policy ledger. Tooling checks exact replay,
source hash, connection/byte ownership and held-out corruption without fitting it away.
M2B/M2C measurements and errors are preserved unchanged.

## Reproduce

```
bun run measure:network          # replaces local observations; review source/environment
bun run check:network            # replay committed measurements and exact derived artifact
bun run debug:network --write    # regenerate synthetic mechanism proofs
bun run perf:network             # separate local executor timing artifact
```

Regeneration of the calibration artifact uses
`bun --no-env-file scripts/reality/network-calibration.ts --write`.
No live listener is required for ordinary replay/tests. A future campaign should
isolate timer/dispatch and framing costs or use a better controlled pacing mechanism
before accepting a host performance model. It must retain new holdouts and avoid
backfitting a latency constant. No production deployment is proposed.
