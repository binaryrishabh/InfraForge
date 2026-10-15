# Model-2 contract and foundation

This document preserves the M2A foundation/replay contract. M2D now supplies the
internal registry default; see [network architecture](m2d-network.md). Explicit M2C
preserves the [compute architecture](m2c-compute.md). Explicit
M2B replay preserves the [workload contract](m2b-workload.md).
The original M2A `createModel2` remains a direct historical proof import/CLI.

Status: internal M2A, explicit version **"2"**, revision `2-m2a-v1`. Published active
model remains **"1"** for Free Mode and all ten challenges. Existing run capture,
worker, evidence, reports and simulation exports are unchanged. The internal
registry resolves1 to the original functions, rejects unknown versions, and requires
an explicit internal option for2. No HTTP/UI selector or automatic migration exists.
Current Docker allowlists exclude the new nested foundation; browser import-closure
checks forbid it. Historical model1 code/catalog/constants/goldens remain untouched.

## Permanent reality contract

Free Mode numbers must be documented provider/service facts, selected configuration,
workload/topology input, derived physical/logical models, researched/calibrated
assumptions or explicitly bounded estimates. Otherwise **Unknown**. A provider's
hardware specification does not establish application RPS, service time or CPU cost.
Confidence describes support/domain, not decorative decimal precision. Facts,
estimates, configured values and missing knowledge must remain distinguishable.

Every resource needs comparable appropriate depth. Depth precedes new families.
Faults change mechanisms; consequences propagate as work/state, not neighbour CPU
taxes. Free and Challenge modes share one physics implementation per model version;
challenges freeze inputs, not special outcomes. Model1 is historical behavior. Model2
requires later acceptance before activation. No frontend beautification in M2A;
Claude's major UI redesign is deferred until the engine foundation is ready.

## Data flow and extension seams

Immutable input/provenance snapshot → request classes/arrivals → identified work →
routing/reachability → resource behavior → admission/queues/worker or connection slots
→ CPU/I/O service stages → child work and return → faults/state evolution → derived
measurements → tariff-specific usage/cost → versioned bounded evidence.

Separate contracts:

- **Capability:** provider/service/region/engine/SKU identity, allocation, configured
  quota and applicable guaranteed/burst bounds, independently sourced per field.
- **Service demand:** application/query class CPU-time, memory/working set, I/O and
  network operations; measured calibration context and validity domain. No universal
  per-vCPU throughput constant.
- **Workload:** class identity, arrivals, start/end/count, payload/operation mix,
  deadline and dependency demand. Current proof supports deterministic periodic
  arrivals and scalar CPU/I/O demand. Sessions, Poisson/trace arrivals, bursts,
  background jobs, cacheability/key reuse, retries and geography are future extensions
  with explicit semantics, not unused fields added now.
- **Resource behavior:** accept/cancel work, apply supported mechanism fault, produce
  measurements. The interface is generic over metric and fault shapes: its station
  defaults do not force CPU/memory fields or a service-pause fault onto an opaque
  managed service. Modules compose service/admission/queue/network/cache mechanisms.
  A compute module does not know database-specific cascade rules. M2A's compute and
  DB stations share finite service/admission; DB additionally reports active slots
  as connections. Router is an explicit sorted round-robin policy with no fabricated
  CPU/memory. Future fanout, joins, asynchronous responses and broker ack lifecycles
  require explicit work ownership/conservation, not implicit graph fanout.

Provider updates create new immutable fact/tariff snapshots, never mutate captured
input or old evidence. A model revision changes if algorithms, time/RNG identity or
mechanism semantics change. Behavior modules register capabilities, not type-pair
effects; adding resource families should add compositions without editing all peers.

## Time decision: event kernel plus sampled evidence

Choose a **hybrid**: discrete virtual events for arrivals, service, faults, deadlines
and control transitions; independent regular observation boundaries for reports.
Fixed one-second stepping cannot faithfully order subsecond service/deadlines without
ad hoc approximations. An all-request network packet simulator is unnecessary for
this educational goal. Resource models can later use analytically justified cohorts
for scale, but must preserve demand and explicitly relinquish unsupported tail claims.

M2A uses safe-integer microseconds and a binary min-heap. Equal-time order is:
fault end, fault start, deadline, service completion, arrival, observation; stable
lexical semantic keys break ties. Expiry is the intervention boundary, not a health
claim. A deadline exactly at completion wins by explicit authored policy. A newly
caused same-time event runs after its cause; zero-time CPU/I/O transitions cannot form
a work cycle because positive total demand and acyclic synchronous topology are
validated. No wall clock appears in model evidence. `advanceTo` includes boundary
events and never advances beyond the authored horizon. Playback only batches calls.

CPU stage duration is ceil(demandCPUus/reservedCoreShare). CPU consumption is capped
by configured demand; I/O occupies a slot but consumes no modeled CPU. Quantization
adds less than1us per CPU stage, an algorithmic resolution bound, not timing accuracy.
Workers reserve equal shares, including idle/waiting reservations; unused CPU is not
redistributed. This is a deliberately narrow queueing-server model, not OS scheduling.

Fault pause freezes remaining CPU/I/O service, invalidates old completion events,
holds admitted slots, permits bounded queuing, then resumes remaining work. Dependency
waits hold caller slots. Timeout cancels retained work and returns one terminal root
outcome. This proof uses strong local cancellation throughout its synchronous chain;
real remote work may continue after timeout. Later cancellation/deadline propagation
must model that distinction rather than silently assuming it.

## Randomness and replay

Philox4x32-10 uses immutable seed/resource/event/purpose/draw identity. Three official
known-answer vectors verify the core. UTF-16 tuple hashing is versioned; name hashes
can collide, so independent statistical streams are not claimed. Ordering unrelated
resources consumes no shared RNG state. Spawn identities must derive from parent,
operation identity and local ordinal, not global iteration. M2A does not inject random
jitter into measured facts and its proof uses deterministic arrivals/demands. An
epistemic interval is not automatically a uniform random variable. Rich stochastic
arrivals/distributions await M2B's measured need and validation.

## Resource mechanisms after M2A

| Area | Contract and acceptance target |
| --- | --- |
| Network | Directed path/reachability, explicit bandwidth and propagation/service delay, byte queues/serialization and connection lifecycle. Shared bottlenecks and transfer metering. RTT, loss and retransmission only where calculated; TCP/application retry layers separate. No per-edge metric before a link mechanism exists. |
| Compute/LB | Resource budgets plus calibrated class demand; worker admission and buffers, CPU scheduling policy, memory allocations, connection reuse, health probes/routing and readiness. Scaling observes sampled demand and provisions through explicit startup states. |
| Database | Query demand, client/server pools, reserved slots, CPU/I/O/working-memory and contention mechanisms. Buffer cache, transactions, durability and replicas add independently validated state. Never infer availability or data recovery from CPU. |
| Cache | Begin with explicit finite keys/bytes, configured cacheable operations, TTL, cold/warm state and deterministic eviction. A calibrated reuse-distance aggregate is an alternative only with traces/error bounds. Miss work reaches the actual origin/dependency. |
| Messaging | Ready/unacked/in-flight/DLQ populations, consumer concurrency/prefetch, processing/ack deadlines, durability/retry/expiry. Accepted−acked−expired−dead-lettered must reconcile with retained backlog. |
| Storage | Operation classes, object/volume bytes, configured IOPS/throughput/latency bounds, queueing, consistency/durability policy and actual allocation lifetime. Managed storage internals opaque unless a model can justify them. |
| Cost | Versioned provider/service/region tariffs with effective dates, units, tiers, minimums, rounding and provenance. Meter provisioned time, requests, operations, storage-byte-time and transfer only as applicable. Unknown component makes the full total Unknown; a known subtotal must be labelled. |
| Health | Raw resource-specific symptoms → limit/state evaluation → local status. Queue/backpressure, admission failures, connection exhaustion and unavailability are distinct. Overall user outcomes derive from defined work populations, not maximum CPU color. |
| Security/remaining resources | Enforce configured reachability/listener/policy semantics separately from advisory static scans. DNS, CDN, registry and monitoring need their own control/data-plane work and evidence. See the complete depth matrix. |

## Fault capability contract

| Fault family | Valid scope and underlying effect | Termination/recovery/evidence | M2A |
| --- | --- | --- | --- |
| Service pause | Explicit compute/DB service station | Freeze service progress, retain slots/queues; removing pause permits remaining work. Queue/active/CPU/returns prove consequences. | Implemented internal proof |
| Process crash | Configured self-hosted process, not every managed icon | Stop acceptance, fail/retain work per explicit policy; restart/readiness and volatile/persistent state determine later behavior. | Designed, pending |
| CPU competition | Resources with explicit CPU budget | Consume available CPU-time; release competing demand at end. Queues/deadlines evolve independently. | Designed, pending |
| Memory leak | Allocating process with modeled retained bytes | Retain allocations/evict/OOM according to resource policy; leak stopping does not free prior bytes automatically. | Designed, pending |
| Network delay/partition | Configured link/path/connection scope | Change service delay or reachability; in-flight work, timeout/retry and reconnection policies determine consequences. | Designed, pending |
| Disk/I/O failure | Explicit volume or I/O stage used by a resource | Stall/reject I/O, then repair/replay per durability policy. DB and VM effects depend on their operations; unavailable does not imply lost data. | Designed, pending |

Every accepted fault requires target capability, parameters/provenance, half-open
intervention interval, start/end event evidence and resource-specific state semantics.
Unsupported combinations fail validation; a fixed failure duration is an experiment
input, not a prediction of real repair time. Failure domains later correlate underlying
faults without pairwise resource hacks. There is no production-recovery badge.

## Provenance, uncertainty, evidence and guardrails

`Quantity` is known/range/unknown with unit and provenance ids. `RealityEntry` separates
classification, confidence, source support extent, assumptions, scope/date and future
Free Mode safety. Provider/protocol facts need exact/bound external support; qualitative
citations cannot certify an exact number. Unpriced or unmodeled outputs are Unknown,
never0. Sum propagates Unknown and preserves bounds. A deterministic proof requires
resolved scalar inputs; ranges are not silently sampled or replaced by midpoints.
M2B should support explicit scenario envelopes/sensitivity and distinct stochastic
distribution assumptions; neither is a confidence interval without a sampling model.

Measurements come from retained mechanism state/counters, with defined units and
populations. CPU is cumulative core-time, queues are stocks, latency belongs to a
specific terminal work outcome. Missing memory/cost are explicit. Logs may report
only modeled events. The internal input snapshot, revision and metric definitions
must travel with evidence; no old Model1 DTO is reinterpreted as M2 evidence.

Bound computation: explicit event/sample/request budgets, finite per-station queues,
lazy arrival scheduling, regular observations and no global telemetry service.
M2A additionally caps256 resources/64 classes to bound recursive synchronous routing.
Budget exhaustion is an execution failure with partial evidence, never an inferred
result. Heap event dispatch is O(log E); acyclic graph validation is O(V+edges).
Per-resource observations and callback depth still limit large topologies; measure
before adopting cohorts, worker parallelism or packet models. The complete Model1
audit JSON is tooling/documentation only and never imported by physics or browser.

## Migration path and architectural self-review

Verification commands: `bun run check:reality`, `bun run test:tooling`, and
`bun --no-env-file packages/simulation/tests/model2Exploration.ts`. The test suite pins
an 81-case sensitivity corpus and 1,000 generated service/queue/deadline cases, checking
population/capacity conservation and complete draining within their authored windows.
Sensitivity digest: `b79a414862f17e7540d49af46161fa56ca5a0b0e6ac98ced827da02f4f684a84`.
Generated-case digest: `b1597b117bc23de160e855fbdf521c05ff97e4683dff4831e419d60760b11f47`.
A local Windows Bun 1.3.14 observation (2026-10-15) processed 129 resources/10,000 requests,
50,269 events and 61 observations in 186.74ms; peak pending events 5,170, JSON evidence
3,065,442 bytes. This single-host timing excludes evidence serialization; it is not a
large-topology service-level guarantee or externally calibrated application result.
All 30 existing Model-1 goldens remain unchanged. Memory/network/price realism is not
established by passing these analytical and metamorphic tests.

M2B: workload/demand profiles, admission/deadline ownership, trace/benchmark harness
and analytic/metamorphic checks. M2C/D can then deepen compute/network and DB/cache
without claiming the proof already models those products. M2E messaging/storage;
M2F resource-specific faults/recovery; M2G provider/cost facts; M2H finish existing
depth; M2I expand families only after depth gates; M2J Free Mode acceptance/activation;
M2K separately version and recalibrate challenges. Provider fact research should run
alongside B–H so it informs capability boundaries, while activation remains deferred.

Before activation: durable input/evidence schemas, version/catalog/fact dispatch,
report compatibility, lifecycle/security/performance validation and explicit migration
policy. Old1 remains readable and executable only through its original contract;
no inferred upgrades, checkpoint resume or new interpretation of historical evidence.

Self-review risks: a generic station is not a universal resource module; do not force
DNS/cache/brokers into synchronous compute calls. Reserved equal CPU shares underuse
capacity and need scheduler research. Strong timeout cancellation is not remote reality.
Current routing lacks network cost/health probes and can send to a paused backend.
No retry, stochastic workload, actual memory, cache, cost or data durability exists
in the proof. Exact replay is implementation verification, not reality validation.
Keep these boundaries explicit as modules and future families grow.
