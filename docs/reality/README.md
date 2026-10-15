# Reality Engine

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
