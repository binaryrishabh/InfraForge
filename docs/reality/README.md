# Reality Engine

M2G: [research](m2g-research.md), [architecture](m2g-architecture.md),
[cross-resource recovery](m2g-recovery.md), [measurements/boundary](m2g-measurements.md)
and [validation](m2g-validation.md). Retained artifacts: `m2g-measurements.json`,
`m2g-calibration.json`, `m2g-proofs.json`, `m2g-performance.json` and
[shipping inventory](shipping-reality.json). `debug:systems`, `check:systems`,
`measure:systems`, `perf:systems` and `check:shipping` are explicit internal CLIs.
`check:model2-shipping` is intentionally closed while visible controls remain partial.

Model 1 remains the only active published physics. Model 2 is internal.
See [audit](audit.md), [resource depth](resource-depth.md), [architecture](model2.md)
and [research](research.md). The machine-readable [ledger](model1-ledger.json) is
checked by `bun run check:reality`; it is not shipped in the API or browser.

No schema migration, historical reinterpretation or Free Mode switch is part of M2A.

`bun run debug:model2` inspects the internal proof at selected phase boundaries with
units, queue/connection/CPU state and metric definitions. Add `--json` for the complete
captured input, provenance and evidence. This is a local diagnostic CLI; it creates
no account, database rows, service or frontend route.

M2B adds [workload/lifecycle architecture](m2b-workload.md),
[deep research and rejected approaches](m2b-research.md),
[profiles and measured calibration](m2b-calibration.md), and
[verification, ledger and performance](m2b-validation.md). Raw measured batches and
bounded held-out traces are source-controlled research artifacts, not runtime data.
`bun run check:calibration` replays them; `bun run debug:workload` inspects overload,
continued remote work, service pause and explicit cancellation. All local profiles
are narrow host-specific candidates forbidden from Free Mode.

M2C adds the dedicated [compute mechanism](m2c-compute.md), [scheduler/memory
research](m2c-research.md), [multi-worker calibration](m2c-calibration.md), and
[proofs, conservation and performance validation](m2c-validation.md). The internal
registry now defaults to `m2c/1`; explicit `m2b/1` and direct M2A replay are preserved.
`bun run check:compute` checks committed measurements/derived profiles;
`bun run debug:compute` inspects synthetic A–F and pause cases. `measure:compute`
replaces local observations and `perf:compute` records separate executor timings.
The measured CPU candidates and abstract resident components are not published
provider physics. Model 2 remains internal; Model 1 remains active.

M2D adds [network/pool/LB mechanisms](m2d-network.md), [primary research and rejected
models](m2d-research.md), [controlled loopback measurements and visible calibration
failure](m2d-calibration.md), and [proofs/conservation/performance](m2d-validation.md).
The internal default is now `m2d/1`; explicit M2C/M2B replay remains. Use
`bun run check:network` for committed measurement/artifact replay and
`bun run debug:network` for the synthetic vertical/fault proofs. `measure:network`
opens bounded temporary loopback sockets; `perf:network` measures the local executor.
The complete host networking predictor is rejected; no cloud/WAN numbers are promoted.

M2E adds separate [relational/cache mechanisms](m2e-data.md), [research and design
decisions](m2e-research.md), [local measurement/calibration limits](m2e-calibration.md)
and [proof/sweep/performance validation](m2e-validation.md). Select `m2e/1` explicitly
through the internal registry. Use `check:data` and `debug:data` for committed replay;
`measure:data` explicitly creates and cleans disposable local fixtures, and
`perf:data` measures the executor. The complete data timing predictor is rejected;
all 54 cache logical sequences match, without claiming calibrated cache latency.
Model 1 remains active, Model 2 internal and production parked.

M2F adds [messaging/object architecture](m2f-async.md), [primary research and profile
decisions](m2f-research.md), [local semantic/calibration campaign](m2f-calibration.md)
and [proofs/sweep/performance](m2f-validation.md). Select internal `m2f/1` explicitly.
`debug:async` and `check:async` replay committed artifacts. `measure:async` creates
and cleans isolated local broker/reference fixtures; `perf:async` measures the
executor. Queue and object timing are not accepted physical predictors. Model 1
remains active, Model 2 internal and production parked.

M2G's [system mechanisms](m2g-architecture.md) add DNS/CDN, policy/TLS, registry startup
and bounded monitoring. M2H adds the [saved-product compiler and real controllers](m2h-product-bridge.md).
`debug:product` retains six authored-design compile/run proofs; `check:product`
replays them with exact-source provenance. `sweep:product` runs 2,048 compiler and
2,048 controller cases; `perf:product` measures the executor. The shipping inventory
separates `PRODUCT_UI_VALIDITY` (`check:product-ui`) from
`MODEL2_REALITY_SHIPPING_READY` (`check:model2-reality-shipping`). Ordinary coverage
validation passes while these explicit readiness checks can correctly refuse.
Internal mechanisms and reviewed software actions do not activate Model 2 publicly.
