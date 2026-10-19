# Stage 0: first-stack launch contract

The launch target is a calibrated narrow web/API stack: load balancer, application compute, PostgreSQL-oriented keyed relational operations and optional keyed cache. This contract does not activate Model 2. Model 1 stays active and Model 2 stays internal; existing composition versions and historical reports retain their identities (`packages/simulation/src/model2/registry.ts:10`; `apps/backend/internalModel2/envelopeV2.ts:34`).

The current connected API is a regression fixture with exactly one LB, two separate application VMs and one database, not the permanent universal schema. It excludes cache, controllers, provider bindings, legacy SKU/security settings, retries and general arbitrary application execution (`apps/backend/internalModel2/connectedScope.ts:9`; `apps/backend/internalModel2/connectedScope.ts:26`). Cache has separate logical mechanisms but needs a later explicit admission contract (`packages/simulation/src/model2/data/contracts.ts:18`; `packages/simulation/src/model2/data/run.ts:22`).

## Claim matrix and evidence

[The generated matrix](launch-claim-matrix.md) maps every inventoried setting/output to its mechanism, sources, current Model-1 label and current Model-2 label. [The manifest](launch-claims.json) enumerates fields explicitly. The checker independently discovers typed declarations, nested controls, actual saved-layout Zod fields, runtime presentation keys and connected JSON projections (`scripts/reality/launch-contract.ts:9`). Adding a field without a claim fails the tooling test; the mutation tests exercise both server-only settings and runtime-built outputs (`scripts/tests/launch-contract.test.ts:12`).

The four labels are `supported-calibrated`, `supported-logical`, `assumption-only` and `unsupported`. No current whole-stack metric is labelled supported-calibrated. Logical correctness is not physical timing validation: the retained network/data calibration gates reject complete timing prediction (`docs/reality/m2d-calibration.md:60`; `docs/reality/m2e-calibration.md:28`). Input demand provenance does not automatically promote an output into a calibrated claim (`packages/simulation/src/model2/workload/profiles.ts:25`). Arbitrary catchall saved JSON remains unsupported, even if storage accepts it (`apps/backend/zod_schemas/layout.schema.ts:35`).

The first engineer workload defaults to an explicitly authored web/API read/write mix with separate DB-backed health operations. Authored aggregate workload generates synthetic spacing; it is not recorded production traffic. Public trace upload and measured-demand onboarding remain later work (`packages/simulation/src/model2/product/workload.ts:23`; `apps/backend/internalModel2/connectedScope.ts:23`). Latency percentiles from a bounded logical run are not a calibrated cloud estimate. The existing presentation keeps full cost Unknown (`packages/simulation/src/model2/product/presentation.ts:7`).

A future launch cost display must label its supported subtotal, covered meters, tariff/date/domain and exclusions. Exact rational pricing supports selected conditional compute estimates; it does not establish a reconciled LB/application/database/cache bill. Keep full cost Unknown until all components reconcile; never substitute missing components with zero or reuse Model-1 educational costs as cloud prices (`packages/simulation/src/reality/provider/pricing.ts:119`; `docs/reality/m2i-provider-foundation.md:173`). Stage 0 maps these semantics; it does not add new tariffs or replace historical cost displays.

## One all-free policy

`apps/backend/capabilities/policy.ts` owns the finite request union and provider seam. Run starts carry purpose, engine/profile and requested simulated duration; the decision covers duration and concurrency. Recorded schedules carry serialized bytes, row count, duration and scale. Design writes carry create/update and net count delta. Exports name an owned artifact, scope and format; live controls also cross the boundary. `AllFreePolicy` returns `all-free/1` and an explicit `no-commercial-cap` allowance. Usage is explicitly unknown because this implementation needs no counting queries (`apps/backend/capabilities/policy.ts:3`; `apps/backend/capabilities/policy.ts:13`; `apps/backend/capabilities/policy.ts:20`).

| Side effect | Authoritative check |
| --- | --- |
| Ordinary deployment and Outbox | `apps/backend/routes/deployment.routes.ts:26` |
| Graded/improvement attempt and Outbox | `apps/backend/challenges/routes.ts:189` |
| Exact/current-design rerun and Outbox | `apps/backend/reruns/routes.ts:60` |
| Internal operator/lesson admission and Outbox | `apps/backend/internalModel2/store.ts:43` |
| Ordinary design create/update, including implicit saves and save-as-new | `apps/backend/routes/infrastructure.routes.ts:18`; `apps/backend/routes/infrastructure.routes.ts:82` |
| Challenge starter/fresh/copy workspace | `apps/backend/challenges/routes.ts:131` |
| Improvement workspace | `apps/backend/challenges/improvementRoutes.ts:29` |
| Internal lesson design creation | `apps/backend/internalModel2/lessonAuthoring.ts:43` |
| Resolved internal trace schedule before persistence | `apps/backend/internalModel2/store.ts:42` |
| HTML report generation | `apps/backend/internalModel2/routes.ts:57` |
| Live actions before durable action/topology mutation | `apps/backend/actions/persistence.ts:42` |
| Worker startup: validate and consume the recorded horizon | `apps/backend/simulator/simulator.ts:36` |

Idempotent internal runs and existing lesson designs return before new capability admission. The policy does not replace ownership, internal grants, fixed challenge predictions, structural/event budgets or execution-host checks. Stop/cancel and evidence reads remain outside commercial gating (`apps/backend/internalModel2/store.ts:27`; `apps/backend/internalModel2/lessonAuthoring.ts:38`; `apps/backend/actions/persistence.ts:22`).

No allowance is added to stored data in this all-free stage. The worker adapter consumes the existing immutable challenge/rerun horizon; an ordinary open-ended run retains a null horizon, not an invented zero or historical duration (`apps/backend/capabilities/policy.ts:33`). Before finite commercial limits, persist a versioned admission decision and atomically reserve account-wide usage across both stores, counting queued/initializing/live work and retained runtime ownership. This later reservation must survive retries and release only after terminal ownership clears. Do not enable finite quotas through the provider interface alone.

`GET /api/deployments/capabilities` supplies advisory availability from the same policy. The designer save/run controls, attempt dialog and rerun form consume that projection; the server remains authoritative (`apps/backend/routes/deployment.routes.ts:38`; `apps/web/src/api/capabilities.api.ts:6`). Availability does not grant access to internal Model 2 or imply public recorded-load support. Export gates server-created HTML convenience artifacts, not saving JSON already displayed in a browser. Ordinary dedicated export and public recorded-load ingest services are absent; any future implementation must cross this facade before materialization/storage/streaming and at resolved admission.

## Common RunRecord, without a storage migration

`infraforge-run-record/1` is a common read projection with engine lineage/version/source, input schema and immutable input, nullable requested horizon, the original versioned report and its Unknown reasons. Optional `learning` holds challenge/lesson identity and optional prediction; there is no audience-specific engine selector (`packages/contracts/src/reports/runRecord.ts:2`).

The strict runtime schema and generated JSON Schema version the outer record. Its input/report payloads deliberately retain their original schemas; the outer version does not claim to revalidate every historical nested format (`apps/backend/runRecords/schema.ts:4`; `docs/reality/run-record.schema.json:1`). The Model-1 and Model-2 adapters use existing readers; absent/corrupt inputs retain null provenance and report limitations instead of reading today's saved design or recompiling history (`apps/backend/runRecords/adapters.ts:10`; `apps/backend/runRecords/adapters.ts:24`).

Read endpoints:

- `GET /api/deployments/:deploymentId/record`, with the ordinary owned report snapshot.
- `GET /api/internal/model2/runs/:id/record`, behind the existing owner and internal-grant/lesson boundaries.

Existing report endpoints remain unchanged in payload shape. No schema migration, stored input/result rewrite, automatic challenge migration or public Model-2 activation occurs (`apps/backend/reports/routes.ts:93`; `apps/backend/internalModel2/routes.ts:62`). The adapters are covered by tests for learner/engineer equality, optional prediction, legacy absence, no mutation and Model-2 operator/lesson identity (`apps/backend/tests/runRecord.test.ts:18`).

## Review and regeneration

Run these after relevant source changes:

```text
bun --no-env-file scripts/reality/launch-contract.ts --write
bun --no-env-file scripts/reality/run-record-schema.ts --write
bun --no-env-file scripts/reality/inventory.ts --write
bun --no-env-file scripts/reality/shipping-inventory.ts --write
```

The stage-0 execution review is pinned to the pre-change commit. Its scope check permits only the named policy/read-adapter integration, packaging files and generated identity metadata; engine/compiler/dependency changes refuse. It reconstructs and freezes the previous descriptor, retains historical snapshots, and updates reviewed transition targets without rewriting saved run identities (`scripts/stage0-identity.ts:11`; `scripts/stage0-identity.ts:25`; `scripts/stage0-identity.ts:45`). The extension uses the existing identity CLI:

```text
bun --no-env-file scripts/execution-identity.ts --review-stage0-syntax
bun --no-env-file scripts/execution-capabilities.ts --review-imports
bun --no-env-file scripts/execution-resolution.ts --build-contract
bun --no-env-file scripts/execution-identity.ts --build-analysis
bun --no-env-file scripts/execution-identity.ts --review-stage0-syntax
bun --no-env-file scripts/execution-capabilities.ts --review-imports
bun --no-env-file scripts/connected-lineage.ts
bun --no-env-file scripts/lesson-endpoint-lineage.ts --refresh-current
bun --no-env-file scripts/m2m-lineage.ts --refresh-current
bun --no-env-file scripts/execution-identity.ts --review-stage0-transitions
bun --no-env-file scripts/execution-identity.ts --check
```

Syntax/import review refreshes exact source hashes with existing permissions; it does not grant new loaders or runtime capabilities. Proof lineage retains original proof bytes and source text. These commands refresh source review metadata, not new physical calibration or browser/host proof results.

## Open questions and defaults

- First calibrated rate/mix/dataset/fault domain and independent validation environment remain Unknown. Default: the named web/API relational workload and explicit conditional demands; keep calibration/activation gates closed until measured holdouts pass.
- Public recorded-load byte/row/horizon budgets and safe account concurrency remain Unknown. Default: retain existing technical bounds and all-free commercial access; no guessed public quotas or upload feature.
- Full-stack billing reconciliation remains Unknown. Default: a labelled supported subtotal only, full cost Unknown.
- Future finite quota persistence is deliberately absent. Default: implement an atomic account-scoped reservation and immutable admission envelope before selecting a finite provider.

The frozen `analysis-boundary/1` reconstruction adds the pre-stage-0 loading-analysis contract to the earlier launch descriptor, preserving its exact source identity (`scripts/historical-analysis-descriptor.ts:5`). Backend image context and copy steps include both new source directories (`.dockerignore:121`; `apps/backend/Dockerfile:34`). Changed UI fingerprints are refreshed as UNREVIEWED, with no inherited browser or physics eligibility.

