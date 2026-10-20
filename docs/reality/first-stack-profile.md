# First stack authoring contract

`first-stack/1` is a separate, internal authoring/review profile. Model 1 stays
active; no product first-stack execution or public availability is enabled. The
separate V2 internal compiler/qualification path is documented in
`first-stack-compile.md`; saved V1 sidecars remain review-only. Timing is
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

## Internal API and retention

All routes are below `/api/internal/model2/first-stack`, after the existing
session/grant middleware, and require operator scope. There is no web control or
public API. `POST /review`, `/save`, `/copy` take `infrastructureId`,
`expectedDesignUpdatedAt` and `sidecar`. Review may omit the sidecar to inspect the
saved draft. Save locks the owned row, validates the content-addressed revision,
and accepts a new sidecar once; the same content is idempotent. Changed content
requires a reviewed copy. Copy sets migration provenance on the server, preserving
the source layout and original row. Fixed challenge inputs refuse authoring
(`apps/backend/firstStack/service.ts:23`). Ordinary layout saves can retain stale
sidecars; review then refuses until an explicit new copy is reviewed.

`POST /workload/resolve` uses content type
`application/x-infraforge-first-stack-import`. Its first UTF-8 JSON line is the
bounded context `{infrastructureId, expectedDesignUpdatedAt, parameters,
transform?}`; the remaining bytes are the JSONL schedule (explicit schedule header
then rows). Context is framing, not part of the recording hash. The parameter
sidecar is `infraforge-first-stack-parameters/1`, with exactly one row ID → finite
plan/exact keys/optional response byte mapping. Bodies, SQL and user code refuse.
Unknown request/response bytes require explicit operation mappings. AtUs is the
schedule offer time; optional intendedAtUs, sentAtUs and generatorLost are retained
separately. Missing generator observations stay Unknown. A conflicting per-row
deadline refuses; operation deadlines are pinned (`apps/backend/firstStack/workload.ts:9`).

The resolver checks capability before consuming schedule bytes and again against
the resolved facts. It caps context before parse and schedule bytes/lines/rows
while streaming, rejects malformed UTF-8, canonicalizes timestamp/ID ties and
parameter ID order, and records original schedule/parameter hashes separately
from transform/resolved identity. Time scaling uses an explicit rational and
shift; noninteger microseconds and transformed overflow refuse. Authored origin
is never promoted to observed recording. The application adapter retains exact
keys through existing child work without cycle/uniform selection
(`apps/backend/firstStack/workload.ts:136`;
`scripts/tests/first-stack-child.test.ts:17`).

Resolution retains no server-side workload and creates no run, Outbox or executor.
The response is a review artifact for the caller; normalized retained-content
storage, deletion policy and atomic run locks remain slice 11 work. Save currently
stores only sidecar references, not schedule bodies. This avoids a new database
schema or weakening existing internal run SQL limits
(`apps/backend/firstStack/routes.ts:15`).

## Source review and regeneration

The Stage 2 producer refuses any engine, dependency, historical qualifier or
unrelated host edit. It checks exact integration deltas, pins the new authoring
sources and acceptance tests separately, replays all eight historical fixtures,
and retains the exact merged Stage 1 descriptor/source snapshot. New first-stack
behavior has its own review lock; compatibility applies only to preserved old
runtime compositions (`scripts/stage2-authoring.ts:31`).

```text
bun --no-env-file scripts/execution-identity.ts --review-stage2-modules
bun --no-env-file scripts/execution-capabilities.ts --review-imports
bun --no-env-file scripts/execution-identity.ts --build-analysis
bun --no-env-file scripts/stage1-lineage.ts --review-analysis-pin
bun --no-env-file scripts/execution-capabilities.ts --review-imports
bun --no-env-file scripts/execution-resolution.ts --build-contract
# Rebuild analysis and review its pin/imports once after resolution changes.
bun --no-env-file scripts/execution-identity.ts --build-analysis
bun --no-env-file scripts/stage1-lineage.ts --review-analysis-pin
bun --no-env-file scripts/execution-capabilities.ts --review-imports
bun --no-env-file scripts/connected-lineage.ts
bun --no-env-file scripts/lesson-endpoint-lineage.ts --refresh-current
bun --no-env-file scripts/m2m-lineage.ts --refresh-current
bun --no-env-file scripts/execution-identity.ts --write-stage2-review-lock
bun --no-env-file scripts/execution-identity.ts --build-stage2-transitions
bun --no-env-file scripts/reality/launch-contract.ts --write
bun --no-env-file scripts/reality/run-record-schema.ts --write
bun --no-env-file scripts/reality/shipping-inventory.ts --write
bun --no-env-file scripts/reality/inventory.ts --write
bun --no-env-file scripts/execution-identity.ts --check
bun --no-env-file scripts/execution-resolution.ts
```

UI handoff: the lead owns semantic inspector fields and diagnostics, immutable
revision/copy review, workload file/parameter selection, transform/cancel review,
and evidence/Unknown labels. This change adds data/API plumbing only; it introduces
no visual design, browser eligibility or public Model 2 journey.
