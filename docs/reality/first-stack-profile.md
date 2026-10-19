# First stack authoring contract

`first-stack/1` is a separate, internal authoring/review profile. Model 1 stays
active; no first-stack execution or public availability is enabled. Timing is
assumption-only; logical counts are supported-logical. Full cost and complete
resident memory remain Unknown. Demand provenance never calibrates output timing
(`packages/contracts/src/first-stack/index.ts:2`).

Stage 1 integration baseline is merged commit
`bd5777e2157339f1a583fb4986843be8a046f0d2`. Its accepted execution descriptor and
eight evidence hashes are frozen in `first-stack-baseline.json`, produced by
`bun --no-env-file scripts/reality/first-stack-baseline.ts --write`.
The historical baseline in `stage1-composition-hashes.json` must never be rewritten
to accommodate this profile (`scripts/reality/composition-proofs.ts:22`).

The graph has exactly one load balancer, 1..8 application VMs and one database.
Cache-absent examples with 1, 2 and 8 apps can be reviewed. The corresponding
cache-present examples preserve their layout but refuse executable review until
the cache bridge is implemented. One app has no app redundancy. No default app
count is converted to simulated cloud capacity. The legacy two-app connected
fixture retains its original scope (`apps/backend/internalModel2/connectedScope.ts:9`).

The field disposition contract is exhaustive for legacy Resource/ConnectionLine
fields (`packages/contracts/src/first-stack/index.ts:83`). IDs/types/directed
endpoints/ports have explicit semantic owners. Names, coordinates, layout version,
SKU, region and size are retained metadata; no SKU capacity is inferred.
Configured security/autoscaling and unknown settings are preserved but refused.
Replacement semantics require explicit compute demands, queues, workers,
cancellation, plain serial transport/bytes/links, DB plans and placement.
Unknown memory reservations cannot admit a shared host. Zero reservations require
explicit authorship in the sourced bundle; admission is not a process RSS proof.

Every numeric input has a named unit in the versioned contract (Us, Bytes,
bytesPerSecond, cores, or a count). The immutable application bundle identifies
authored/measured origin, source/version and workload/runtime/hardware domain.
Recorded origin is separate. The sidecar binds a content-addressed layout revision,
profile/compiler, operation mappings, pools/paths, hosts, workload references,
empty fault schedule and versioned metric/retention policy. Historical layout
catchall JSON round-trips unchanged (`apps/backend/zod_schemas/layout.schema.ts:8`).

The authoring envelope caps semantic input at 16 MiB, JSONL at 8 MiB, each line
at 16 KiB, roots at 20,000, keys at 10,000, operations at 32 and duration at 300 s.
These are qualification ceilings, not demonstrated safe execution capacities.
The initial review does not authorize an executor, queue, storage reservation,
host readiness or public trace admission. Existing internal runtime limits stay
unchanged (`apps/backend/internalModel2/budgets.ts:1`).

Future report locks must bind original input/semantic/compiler/module identities,
schedule/parameters/transforms/seed, demand bundle, faults, technical envelope and
metric/retention versions. Reports must distinguish simulated observation from
real-world evidence labels; caller/attempt/remote outcomes, censoring, population,
window and completeness stay separate. Timing p50/p95/p99 requires at least
2/20/100 terminal observations and an explicit exact-rank or interval method.
Supported compute subtotal requires eligible usage and a frozen quote; otherwise
subtotal and full cost are Unknown. These are future execution/report obligations,
not implemented measurements (`packages/simulation/src/model2/workload/evidence.ts:23`).
