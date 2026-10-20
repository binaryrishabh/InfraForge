# First-stack execution bounds (slice 10a)

Model 1 remains active. This is an internal software qualification path over the
slice 04 cache-free compiler, not public execution or intended-host readiness.
PostgreSQL session/transaction mechanisms are unchanged. The only data adapter
change forwards the host slice API. (`packages/simulation/src/firstStack/run.ts:11`,
`packages/simulation/src/model2/data/run.ts:47`)

The captured `first-stack-envelope/1` sets 2,000,000 total events, 50,000 pending
events, 10,000 live transport calls/callers, 32 operations, 10,000 keys and a
1 MiB cumulative identity/key dictionary. Each queue/pool/worker/session count
also has a finite ceiling; the data module's smaller existing limits still apply.
Inputs are measured as finite JSON before review copies. Preflight names roots,
health probe starts, paths, attempts, serialization limits and uncertainty: event
and RSS forecasts remain Unknown, while obvious work/queue/dictionary excess
refuses. (`packages/simulation/src/firstStack/bounds.ts:7`,
`apps/backend/firstStack/execution.ts:30`)

An event slice stops after at most 128 events, including equal-time work; it does
not advance to the requested horizon until every due event is processed. The
internal async executor yields between cooperative slices, checks cancellation,
30 s process CPU, 60 s wall time and observed RSS against a 512 MiB target, and
refuses insufficient observed headroom. Its 25 ms slice-time target is checked
between event batches. These observations cannot preempt a synchronous event,
serializer, a hung persistence callback or an OS kill. Slice 10b must enforce the
768 MiB hard ceiling and isolate both execute and replay before activation.
(`packages/simulation/src/model2/time.ts:73`,
`apps/backend/firstStack/boundedExecution.ts:35`)

All transport exchanges, including LB health/attempt exchanges, share the call
budget. Bounded histograms retain every terminal observation independent of raw
row/journal omission. Raw result/transport rows each retain at most 1 MiB;
samples retain a prefix of at most 128 and 2 MiB. Omitted samples cannot support
complete interval reconstruction; current cumulative counts/histograms remain
available. Distributions name terminal callers by operation/outcome, with
unfinished callers right-censored. (`packages/simulation/src/model2/network/run.ts:75`,
`packages/simulation/src/model2/network/transport.ts:16`,
`packages/simulation/src/model2/workload/evidence.ts:21`,
`packages/simulation/src/model2/workload/run.ts:116`)

The diagnostic journal retains at most 16 MiB with observed/retained/omitted
counts. Each frame is at most 1 MiB, final summary 10 MiB, and acknowledged
frames plus returned summary and journal at most 32 MiB. JSON byte accounting
includes UTF-8 and escaping; serialization stops before retaining excess output.
Frames contain aggregate cuts, not repeated raw journals. Cuts and summaries
record effective technical limits, including any operator-selected lower ceilings. The caller supplies an
atomic, fenced persistence callback; only its successful acknowledgement advances
`durablePrefix`. Without a store, durable prefix is null. Storage/event/RSS/output
exhaustion returns `executor-interrupted`, never an infrastructure-failure verdict.
A failed event or write retains the preceding committed cut; no crash continuation
is offered. Horizon, root completion, aggregate prefix, usage prefix and diagnostic
completeness are independent. A cut names unfinished offers, callers and pending
events, and whether equal-time events remain at its timestamp. (`packages/simulation/src/firstStack/journal.ts:5`,
`apps/backend/firstStack/boundedExecution.ts:10`,
`apps/backend/firstStack/boundedExecution.ts:62`)

No database migration, public queue/reservation/storage admission, worker lease,
artifact deletion policy or UI is introduced. The 8 GB laptop and 4 vCPU / 8 GiB
server remain unqualified. Keep one isolated worker as the proposed default for
10b; no two-worker or 250 ms end-to-end responsiveness claim follows from this
pilot. Compile/setup/execute/reduce/serialize timings are separately recorded by
`bun --no-env-file scripts/reality/first-stack-bounds-proof.ts --measure`.
(`scripts/reality/first-stack-bounds-proof.ts:39`)

Reproduce software proofs with:

```
bun --no-env-file scripts/reality/first-stack-bounds-proof.ts
bun --no-env-file scripts/reality/first-stack-compile-proof.ts
bun --no-env-file --no-install test scripts/tests/first-stack-bounds.test.ts
```

The original slice 04 proof and Stage 1 host baseline are retained unchanged.
New bounded compiler evidence lives in `first-stack-bounds-compile-proof.json`.
`first-stack-bounds-host.json` retains the pre-bounds host source and separately
pins current optional host changes. The historical extension verifier reconstructs
the original 88-file source scope; it does not assert current host bytes are
unchanged. All eight historical replay hashes must still match. Stage 1 source
lineage and the exact source transition preserve original producer bytes.
(`scripts/stage2-bounds-host.ts:6`,
`scripts/reality/composition-host-proof.ts:12`,
`scripts/stage2-authoring.ts:146`)

Refresh reviewed artifacts using their owning scripts, in dependency order:

```
bun --no-env-file scripts/stage2-bounds-host.ts --write
bun --no-env-file scripts/stage1-lineage.ts --write
bun --no-env-file scripts/reality/first-stack-bounds-proof.ts --write
bun --no-env-file scripts/reality/first-stack-compile-proof.ts --write
bun --no-env-file scripts/execution-identity.ts --review-stage2-modules
bun --no-env-file scripts/execution-capabilities.ts --review-imports
bun --no-env-file scripts/execution-identity.ts --build-analysis
bun --no-env-file scripts/stage1-lineage.ts --review-analysis-pin
bun --no-env-file scripts/execution-capabilities.ts --review-imports
bun --no-env-file scripts/execution-resolution.ts --build-contract
```

After selection changes, repeat analysis/pin/import review, then refresh connected,
M2M and lesson endpoint lineage. Write the Stage 2 review lock before building its
transitions. Refresh launch/run-record/shipping/inventory with their scripts and
verify identity/resolution. Hashes always normalize CRLF to LF.
