# M2I: versioned provider, placement and billing foundation

Model 1 **ACTIVE**, Model 2 **INTERNAL**, production **PARKED**. This is an internal
compiler/runtime extension. No normal UI/API activation, historical reinterpretation,
challenge migration, provider account access or production operation is included.

## Research and bounded scope

M2I implements one provider adapter deeply: **AWS / AmazonEC2 / m5.large /
us-east-1 / Linux / Shared / OnDemand / no preinstalled software / Used capacity**.
The public regional AWS Bulk CSV published **2026-10-15T19:13:16Z**, version
`20261015191316`, supplied SKU `6C86BEPQVG73ZGGR` and rate
`6C86BEPQVG73ZGGR.JRTCKXETXF.6YS6EN2CT7`: **USD 0.0960000000 per instance-hour**,
effective 2026-10-01, **2 vCPUs**, **8 GiB**. The exact row, headers, publication and
retrieval metadata are in [m2i-ec2-source.json](m2i-ec2-source.json).

[AWS Bulk API documentation](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html)
and [service price file definitions](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/reading-service-price-list-file-for-services.html)
separate product attributes, term/rate identity, units, ranges, publication version
and effective dates. M2I retains those distinctions rather than treating a catalog
monthly estimate as a price. Importing the selected CSV row read **42,876,928 bytes**
and stopped after **55,734 rows**, below the explicit 64-MiB/90-second capture
budget. The complete 302,869,403-byte regional CSV was not retained. Public data
access used no AWS credentials or account. No online calls occur in CI or runtime.

[EC2 lifecycle documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)
distinguishes unbilled pending/stopped states from billed running state, including
idle time. It specifies a one-minute minimum per start and continuous billing
through reboot. Hibernation has different stopping-state treatment. M2I supports
only the selected nonhibernating Linux instance-time rule: one-second increments,
60-second minimum per allocation identity. Process readiness is a different
concept from cloud running/billing state. The mapping described below is authored
and conditional, not an observation of real EC2 provisioning.

[General-purpose instance specifications](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html)
support hardware capability research, not application throughput. Only the exact
selected row's vCPU and binary-memory descriptors enter this adapter. Clock speed,
network performance, EBS throughput and every other raw CSV attribute remain unused.
An authored no-oversubscription policy bounds the sum of role CPU allocations by
the logical vCPU count. It does not equate vCPUs with physical cores or establish
effective CPU, SMT scheduling, RPS, service demand or provision time.

[AWS zone identities](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html)
identify `use1-az1` and `use1-az2` within `us-east-1`. M2I uses qualified stable
IDs (`aws:aws:use1-az1`), with explicit provider/partition/region relationships.
Account zone-name aliases are refused; a public price listing establishes only
regional listing, not account/zone offering, quota or live capacity. Region and
zone labels never supply distance, bandwidth, latency or outage probabilities.

[Azure state billing](https://learn.microsoft.com/en-us/azure/virtual-machines/states-billing)
charges a stopped allocated VM while treating deallocation differently. This
differs from EC2 stopped-instance treatment. [Google Compute pricing](https://cloud.google.com/products/compute/pricing)
also has its own resource, commitment and discount terms. Neither provider has a
verified pricing adapter in M2I. Provider-specific identity and scope checks refuse
using the EC2 rule as a universal cloud rule.

[S3 pricing](https://aws.amazon.com/s3/pricing/) distinguishes storage, operation,
request, retrieval and transfer dimensions and service-specific exceptions. EC2
[data-transfer terms](https://aws.amazon.com/ec2/pricing/on-demand/) additionally
include aggregate cross-service/account allowances. A directed link payload counter
cannot establish billable Internet egress, and object count is not byte-time
occupancy. M2I implements exact generic quantity primitives but deliberately leaves
S3/storage/operation/transfer provider adapters unpriced. No fabricated coverage or
sampled-storage integral is substituted.

[Timestamped review hashes](m2i-source-reviews.json) retain source URLs, actual
retrieval timestamps and normalized UTF-8 content hashes without copying full
webpages. Undated documentation has publication date **Unknown**. The reviewed
snapshot expires **2026-11-01T00:00:00Z** by an authored review policy; this is not a
provider guarantee or a published price-effective end date. Results describe the
selected quote vintage, never a live price lookup or an actual invoice.

## Internal architecture and provenance

The small modules under `packages/simulation/src/reality/provider` own facts,
validity/bounds, exact quantities, locations, pricing, compilation, usage and run
presentation. `compileProviderProduct` accepts an actual M2H saved design and
application/infrastructure contract plus a versioned provider sidecar and snapshot.
It checks source validity, the pinned snapshot version and SHA-256 content identity,
then invokes the unchanged M2H compiler. The compiled provider/product payload has
its own content fingerprint; mutation requires explicit recompilation.

The snapshot contains provider/service/product scope, source dates and uncertainty,
stable locations, capabilities and explicit price terms. Authored host partitions,
placements, lifecycle assumptions and incidents remain in the sidecar. M2H's
quantity ledger retains authored application CPU/memory demand and receives an
exact externally sourced vCPU descriptor with Free Mode forbidden. No capability
automatically sets execution capacity. The legacy catalog's GB label, approximate
monthly price and performance fields are not promoted.

Content fingerprints detect changes under a pinned version. They do not authenticate
a provider publication or turn authored input into an independently verified fact.
The retained scoped raw row and primary-source review remain separately inspectable.

Bindings require all owned roles and every finite pool slot to be declared.
Compiler lookups index saved nodes, facts, prices and sources. The pre-allocation
slot guard preserves M2H's 128-slot bound; existing lower resource/path budgets
still apply. The 32-slot performance case has 107 runtime roles and 201 paths.
Missing roles, duplicate identities, unknown sources, date/version/content drift,
conflicting limits, unsupported pricing and unresolved placement fail clearly.

## Capabilities with actual consequences

For compute roles with explicitly **complete authored modeled memory**, the selected
partition becomes the existing M2C `reject-allocation` limit. A low partition rejects
actual calls and reduces completion/health admission. The compiler never changes
partial memory coverage into complete coverage. Completeness here concerns the
authored modeled process, not actual cloud process or whole-host RAM.

Auxiliary cache-aside/artifact roles keep **reservation** semantics. They have no
new physical resident-memory enforcement. The known artifact cache byte capacity
must fit its reservation; unmodeled overhead and complete host memory stay Unknown.
The sum of authored reservations must fit the selected binary-memory capability.
CPU partitions remain authored and bounded; they do not become provider-calibrated
execution. GiB conversion is dimensional (`8 × 1024³ bytes`), not a speed factor.

## Location and failure domains

Locations form a bounded region→zone hierarchy within one provider partition.
Same-zone/different-zone constraints require explicit zone placements and are
validated. Relationships can describe same-zone, same-region, cross-region,
cross-provider/partition or Unknown without inventing transport physics.

An explicit `selected-process-loss/1` incident names a domain, a set of bound VM
nodes and authored start/duration/restart quantities. Membership fans out to the
existing M2H primary compute-process crash mechanism for matching finite identities.
Their real availability/readiness gates change and affect actual LB service and
request outcomes. A zone incident affects its members; a region incident covers
both selected zones. Fault end remains different from restart readiness.

This is **selected process loss scoped by placement**, not a complete physical AZ
outage. It does not destroy every auxiliary, simulate provider allocation failure,
change a managed regional service, reroute across regions or assign correlated
failure probabilities. Managed-service fate and unknown domain membership refuse
instead of being silently guessed. Future allocation remains constrained by the
authored controller; live provider availability is Unknown.

## Usage and billing

`provision-complete-to-termination/1` explicitly maps the first actual M2H
`artifact-start` event (after authored provision delay) to modeled billable
allocation. Pending provisioning, dormant slots and terminal provision failures
have no allocation session. Artifact retries, process crashes, startup, ready/idle
time and draining retain allocation; actual termination closes it. Captures retain
the interval boundaries and exact integer microseconds with the mapping assumption.
This is conditional EC2 estimation over a reviewed authored state mapping.

Each capture recomputes cumulative allocation estimates from original starts.
Captures are not additive invoices; duplicate usage identities are refused when
summing estimates. Missing/omitted lifecycle records make the subtotal Unknown.
Usage scope is selected independently of the quote: unpriced hosts still retain
their known allocation intervals and quantities, while the monetary result is Unknown.
Known complete coverage before any allocation supports a justified zero selected
compute subtotal; the full cost still stays Unknown.

Money uses reduced arbitrary-precision rational numbers and decimal strings.
No binary floating-point currency accumulation, implicit 730-hour month, percentage
discount, currency conversion or rounding to zero occurs. Each rule declares raw
meter units, price denominator, currency, scope, increment, minimum, graduated
contiguous tiers, aggregation, version and validity window. Price publication and
billing-policy sources have separate required provenance references. The EC2 rule uses
3,600,000,000 instance-microseconds per quoted hour and separate per-start minimums.
Fractions below one cent are retained; invoice-level rounding is unsupported.

Generic authored tariffs can verify graduated whole-window operation, byte and
byte-time arithmetic. Such synthetic prices are labeled authored verification
inputs and never represented as provider facts. Operation counters need a stable
epoch; resets/decreases return Unknown. Occupancy integrates complete ordered
mutation boundaries exactly and conserves byte-time across cut windows. The current
object runtime lacks a complete retained mutation timeline, so its storage billing
remains Unknown. Summing snapshots or sampled occupancy would invent usage.

Missing/duplicate/overlapping usage, dimensional/scope mismatch, incomplete
aggregation windows, unknown currency components and a window spanning a price
change return Unknown or reject an invalid rule. Price-change splitting with one
minimum across terms is deferred. Reserved/Spot/Savings Plans, software licensing,
hibernation, EBS, public IP, transfer allowances, taxes, credits, minimum storage
durations and whole-account aggregation are unsupported provider cases.

## Presentation and gates

The internal provider presentation retains M2H Observed/Interpreted/Unknown values.
Selected compute cost is **Interpreted**, with an exact rational amount, currency,
source version and authored mapping. Full cost is **Unknown** because other services
and meters are unpriced. Raw directed-link delivered bytes are labeled modeled
payload usage and do not select a transfer rate.

Normal UI remains on Model 1. Shipping classifications are unchanged:
**441 surfaces, 177 technical blockers, 252 UI behavior reviews**. Neither readiness
gate is forced open. No provider selector, region label or cost display is made
eligible by this internal extension.

## Verification and retained evidence cost

[m2i-proofs.json](m2i-proofs.json) retains one complete authored saved-product base,
source/compiled hashes, versioned variant instructions and 32 captures across eight
cases: normal, memory admission, zone incident, region incident, registry retry,
manual drain, failed provisioning and unpriced allocation. It includes actual
controller populations/lifecycle, endpoints/LB state, resource/memory counters,
usage and estimates. Compiled inputs reconstruct deterministically. Repeated full
configuration and routine per-request traces are omitted explicitly.

The replay also checks 1,024 deterministic billing vectors and 128 provider-compiler
cases (64 accepted, 64 refused). Ten separately retained [analytic boundary vectors](m2i-heldout-billing.json)
test subsecond, minimum, whole-hour and separate-start behavior against exact
answers. These are arithmetic holdouts, not a fitted physical predictor. Tests also
cover scope/unit errors, dates, content/version drift, unsupported provider terms,
duplicate charging, occupancy conservation, counter resets, partial memory, early
allocation-budget refusal, process incidents, manual drain and missing evidence.

New M2I JSON artifacts have a combined **one-MiB hard review budget**, checked by
tooling tests. The new proof bundle uses compact JSON without removing semantic
content; human-readable interpretation is here. Existing M2A–M2H evidence remains
unchanged, including the 23,430,083-byte M2H proof and 14,237,168-byte M2G performance
artifact. No useful historical proof is deleted or reserialized.

[m2i-performance.json](m2i-performance.json) separates compilation, setup, virtual
execution, evidence, 10,000-session billing and serialization wall-clock costs.
It records source hash and host environment. These measurements describe one
developer executor, not cloud physical time or statistical scalability.

Commands: `bun run check:provider`, `bun run debug:provider` (explicit regeneration),
`bun run perf:provider`; focused package tests are `providerPricing.test.ts` and
`providerProduct.test.ts`. Tooling replay is offline. The pure engine receives an
explicit SHA-256 host port; test/tooling adapters use built-in crypto outside the
pure package. No new package or lockfile change is needed. No public simulation
export is added.

## Deliberate deferrals

Provider facts are a reviewed narrow snapshot, not an exhaustive service catalog or
automatic price discovery service. Real provision timing, effective CPU, credits,
SMT performance, full resident memory, device loss, durability, regional distances,
physical network transfer, availability probabilities and recovery remain Unknown.
Existing rejected M2D/M2E/M2F timing predictors and M2G timing Unknown are preserved.
Other providers/services, complete storage/operation/transfer meters, price-change
allocation, account discounts and invoice rounding need separate mechanisms/proofs.
UI/UX redesign and Model-1 retirement remain separate future owner decisions.
