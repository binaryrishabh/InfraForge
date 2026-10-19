# Internal composition and ownership

Model 1 remains active. `createStackComposition` is an internal, opt-in composition
for the load-balancer, application compute, relational and optional keyed-cache
stack. It reuses the event heap, schedulers, transport, work identities and data
mechanisms. It introduces no calibration or provider-performance claim.

`composition/registry.ts` resolves a kind to one trusted, statically imported
module. A module owns its versioned request-port manifest, validation and factory.
Unknown kinds, duplicate owners and incompatible host APIs fail before factory
effects. The clock/send/causal/CPU interfaces live in `composition/host.ts`.
Compute, relational, cache, cache-aside and LB factories now register through
their respective `module.ts`/`modules.ts` files. Family validators and adapters
remain available to the pinned m2b–m2h compatibility compositions; the old entry
points keep their evidence formats, scheduling keys and per-resource owners.

The new composition optionally binds CPU consumers to explicit physical host
owners. Each host has one capped-equal-fluid scheduler. Member leases namespace
call IDs, suspend only owned work, preserve already consumed service and release
their outstanding callbacks on retirement. Pool core-time is authoritative;
member available-core-time fields refer to the same host and are not additive.
Version 1 requires member capacity to match the declared host and refuses shared
per-role quotas/capacity interventions rather than inventing their semantics.

Memory is an explicit, authored reservation/admission budget. Known reservations
cannot exceed the known owner capacity, Unknown cannot be admitted as zero, and
release is idempotent. This is not a complete resident-process model. Relational
and cache process coverage remains Unknown where the underlying modules say so.

Lifecycle identities follow create → register → ready → drain → retire. A reused
identity receives a new generation; stale handles fail closed. Owned clock
callbacks use identity/generation/key and are removed on retirement. The stack
wrapper gates drain through network readiness, refuses retirement with live work,
then releases CPU and memory leases. It materializes the authored resources once;
lazy scaling, rematerializing resource state and general membership policies are
later work, not implied by the lifecycle service.

Independent request mechanisms implement `RequestPlugin`, validate their own
configuration and receive only a generation-scoped clock. A gate forwards through
the real receipt chain or rejects synchronously. Plug-in order is retained in
composition evidence. A plug-in needs no kernel or peer-resource implementation
change. These are trusted modules, not an untrusted-code sandbox.

`composition/token-bucket.ts` is the extension proof. Its module owns the
configuration validator and an O(1), scoped request admission mechanism. It uses
authored integer capacity/initial credits and discrete refill tokens/period;
missing values are refused. It forwards the original cancellation receipt and
does not refund credits after downstream failure/cancellation. Refills are lazy,
bounded and observable without mutating state. Scope includes a target and an
optional operation. The state retains the full numerical configuration and policy
revision. No kernel, host or peer-resource source changed to add it: verify all
88 LF-normalized source hashes with
`bun --no-env-file scripts/reality/composition-host-proof.ts`.

The pre-refactor evidence hashes in `stage1-composition-hashes.json` were captured
using the existing workload, compute, network, LB, data, async, systems and product
fixtures. Run `bun --no-env-file scripts/reality/composition-proofs.ts` to compare
all eight. Never regenerate that baseline to accommodate a refactor.

Historical source lineage is separate from accepted evidence. After reviewing
a change, run `scripts/stage1-lineage.ts --write --review-modules`; it refuses to
write unless all eight pinned replays match. Refresh connected lineage with
`scripts/connected-lineage.ts`; it retains original source bytes and records the
current pins. Historical foundation/provider/metering proofs reconstruct through
that retained source and their existing frozen projections.

Execution identity refresh order, using `bun --no-env-file` for every script:

1. Generate Prisma with the backend's `db:generate` script.
2. Refresh the exact module reviews with `scripts/stage1-lineage.ts --review-modules`.
3. Run `scripts/execution-identity.ts --build-analysis`.
4. Run `scripts/stage1-lineage.ts --review-analysis-pin`, followed by
   `scripts/execution-capabilities.ts --review-imports`.
5. Run `scripts/execution-resolution.ts --build-contract`. If selected source
   bytes changed, repeat steps 3–4 to bind the new selection contract. This is
   needed because both the module reviews and selection contract bind the analysis.
6. Refresh `scripts/connected-lineage.ts`, then
   `scripts/lesson-endpoint-lineage.ts --refresh-current` and
   `scripts/m2m-lineage.ts --refresh-current`.
7. Run `scripts/execution-identity.ts --build-composition-transitions`.
8. Regenerate `scripts/reality/launch-contract.ts --write`,
   `scripts/reality/run-record-schema.ts --write`,
   `scripts/reality/shipping-inventory.ts --write`, and
   `scripts/reality/inventory.ts --write`.
9. Run `scripts/execution-identity.ts --check` and `scripts/execution-resolution.ts`.

The transition builder is pinned to accepted main `31c4a92` and composition
`c0df52c`. It preserves both histories and their compressed source snapshots,
checks the permitted source scope, all eight replay hashes and all 88 host/peer
source hashes, and records an explicit reviewed target. The frozen archive also
supports regeneration in clones without the old composition Git objects. A new
execution change requires its own scope review and transition; this command is
not a general approval for subsequent changes. Different execution descriptors
remain distinct, and historical results are not silently relabelled.
