# M2H: saved product design to internal Model 2

Model 1 remains ACTIVE, Model 2 INTERNAL, production PARKED. This compiler is not
imported by normal UI/API dispatch and does not migrate saved runs or challenges.

## Research and design decisions

The gap was a compiler boundary, rather than a missing throughput formula. The
[LLVM frontend tutorial](https://llvm.org/docs/tutorial/MyFirstLanguageFrontend/LangImpl02.html)
illustrates separating authored syntax from a representation used by later phases.
M2H uses a canonical semantic spec with explicit diagnostics before materializing
the existing engine contracts. This is a design inference, not LLVM compatibility.

[W3C PROV-DM](https://www.w3.org/TR/prov-dm/) motivates retaining derivation and
source identity. M2H distinguishes authored values, application profiles, provider
facts, compiler arithmetic, implementation policy and Unknown. Quantity references
must resolve to exact ledger values. Raw structural/trace numbers have separate
source paths; missing provenance refuses compilation.

[Kubernetes autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
documents sampled reconciliation, readiness, missing metrics and stabilization.
M2H selects its own `generic-reconcile/1` policy: ratio-based recommendations at
authored evaluation times, explicit target/tolerance, conservative hold for a
missing complete metric interval, cooldown, a downscale recommendation window,
and no automatic downscale while startup/failure remains pending. Kubernetes
initialization periods, metrics APIs, policies and defaults are not reproduced.

[Pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
separates readiness and termination. M2H stops LB selection, drains actual work,
then terminates on quiescence or authored grace. In-flight children can retain
remote effects until their own cancellation/timeout; aborting a caller does not
undo a database commit. [Envoy health checking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/health_checking)
also separates health observations from routing. M2H reuses M2D health probes;
opening a process readiness gate does not directly grant LB eligibility.

[OCI Distribution](https://github.com/opencontainers/distribution-spec/blob/main/spec.md)
distinguishes manifests, blobs, digest identity and mutable references. M2H composes
the narrow M2G registry/client; provisioning does not synthesize image bytes or a
fixed image-pull duration. This is not OCI conformance or real container execution.

[OpenTelemetry's data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)
distinguishes measurement time and cumulative/delta intervals. The observed
controller consumes only backend-arrived M2G measurements of actual cumulative
core-time counters. Missing/stale samples hold desired capacity, and a new valid
interval is required after an observation gap. It never reads live CPU through a
telemetry fallback. The direct profile reads M2C counters explicitly instead.

[EC2 general-purpose specifications](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html)
are useful for capability facts, not workload throughput. The existing catalog
calls prices, connection limits and several factors approximate/unverified.
M2H accepts only a matching catalog version/SKU/category and exact field-specific
external ledger fact. Even a verified vCPU descriptor does not set effective M2C
cores, credit availability, memory residency, RPS, provision time or cost.

## Authored boundary and normalized spec

`SavedProductDesign` contains the same `Resource[]`, `ConnectionLine[]` and
`WorkloadProfile` types that the product persists. `ProductContract` is an explicit,
versioned internal sidecar, suitable for future persistence without changing
historical domain schemas. It supplies a first-class application profile, reviewed
node settings, edge purposes, transport profiles, security, controller policy,
initial state, bounded bootstrap commands and provenance. It does not accept an
already written `SystemsInput` as a substitute for compilation.

The semantic spec retains design/schema, compiler, model, application, catalog,
workload and contract versions. It records every resource translation owner,
semantic connection, sourced capability, numerical origin and scoped Unknown.
Legacy exposure/region fields are retained separately as history. Size, coordinates
and display names are omitted from physics. Output is canonical, with stable
semantic IDs; resource and drawn-edge ordering cannot choose runtime scheduling.

The application profile owns operation identities, CPU/blocking/memory demand
profiles, validity, idempotency, deadlines and payload bindings. Node execution
settings separately own workers/concurrency, effective authored CPU and admission.
Dependency adapters express actual per-operation read/write/cache/database plans.
An application label or hardware SKU alone cannot supply any of these quantities.

Every visible resource has an owner in `product/owners.ts`. Small resource profiles
select the existing mechanisms, not a resource-type capacity constant. A single
visible node may explicitly own auxiliary roles (resolver, cache-aside stage,
artifact client, telemetry backend). These roles have their own identities,
listeners and internal edges. An undeclared helper/path is not manufactured.

## Workload mapping

| Current field | Internal interpretation | Required extra information / refusal |
| --- | --- | --- |
| targetThroughput | Authored requests per selected time unit, open-loop arrivals | Positive finite rate; no user/session-to-request conversion |
| throughputUnit | Dimensional minute/hour conversion | Explicit supported unit |
| readWriteRatio | Fraction choosing named application operations | Explicit fraction and read/write meanings; never query cost |
| payloadSize | Label selecting exact application request-byte quantities | No generic light/medium/heavy byte constants |
| trafficShape | Steady or explicitly windowed peak | Current label alone does not establish peak timing |
| peakMultiplier | Arrival spacing change inside that window | Explicit window and multiplier; reject sub-microsecond rates |

The selected `product-arrivals/1` policy uses deterministic spacing and an operation
mixture accumulator, rounded to integer microseconds. It is not a Poisson process
or calibrated population model. The current UI's Model-1 burst hint is historical;
M2H does not silently copy its timing into a new run.

## Topology and security

Each saved edge needs dependency, routing, origin, DNS-query, artifact, monitoring,
telemetry-export, consumer or policy-attachment intent. Missing/ambiguous intent
refuses compilation. Node profiles can declare internal role-to-role edges.
Explicit transport profiles own every directed hop, bandwidth, propagation,
buffer, request/response bytes, pool, timeout, listener, DNS and security decision.
A drawing line never establishes physical bandwidth or geographic distance.
Transport templates explicitly select `per-path` or `shared` directed-link ownership.
A shared-link proof gives DNS bootstrap and application traffic one common authored
bottleneck. Conflicting definitions are refused; sharing is never inferred.

Legacy `public`, `encryption` and `openPorts` do not set transport truth. A new
contract requires `explicit-reviewed/1`, actual listeners, external entry intent,
firewall attachments and plaintext/authenticated TLS policies. The M2G security
plane derives reachability and blocks incompatible delivery. Old booleans can
change historical metadata without changing compiled physics. Missing listeners
or conflicting drawn-port intent produce named diagnostics.

## Controller lifecycle

The compiler materializes a finite authored slot inventory. Dormant slots have no
serving eligibility; controller evidence marks their identities `reserved` until
an actual creation decision. This is bounded preallocation, not dynamic provider
node allocation. Exhausted creation slots remain an explicit evidence condition.

Desired, provisioning, pulling, starting, process-ready, LB in-service, draining,
failed and terminated populations remain distinct. Provisioning delay/failure is
authored generic policy with no provider latency claim. Artifact clients resolve
the actual registry manifest and acquire missing layers through network/object
mechanisms. Explicit initial layer ownership can model an already populated node
cache; it must fit capacity and does not remove manifest resolution. Shared cache
clients can be bound explicitly; caches are not globally shared by a multiplier.

After artifacts, an authored startup delay opens the process/listener gate. Its
physical initialization CPU, memory and provider validity remain Unknown. LB health
probes still need to succeed. Readiness does not require every dependency unless
the authored application/health operation actually performs that dependency work.

CPU recommendations use consumed application plus competitor core-time divided by
available core-time over an actual retained interval. The selected direct or
observed owner is explicit. Intervals beginning before readiness, repeated counters,
missing observations, stale data, resets and zero available core-time cannot become
current utilization. Downscale uses the highest recommendation within the authored
stabilization window. Manual commands set desired count through the same reconciler.

Scale-in first stops new LB routing. Existing work gets the authored drain grace;
on termination, compute calls are aborted, owned request memory is released and
owned outgoing paths reset, closing database sessions. Remote effects already
committed are not reversed. Terminated slots are not silently recycled. Vertical
resize remains unavailable: no new provider-specific restart/replacement contract
is claimed.

## Resource-specific fault boundary

`product/faults.ts` is the machine-readable eleven-by-five compatibility matrix.
Crash targets a particular authored process role; a DNS authority crash is not
automatically a resolver crash. Every crash requires an explicit logical retention
profile and positive restart/readiness delay. Independent readiness owners prevent
fault end or artifact completion from bypassing restart or termination gates.

| Owner | Crash state / recovery |
| --- | --- |
| Compute | Abort calls/release request allocations; child effects follow actual cancellation; explicit restart gate |
| Cache | Abort commands and flush volatile keys/generations; restart cold |
| Database | Abort uncommitted transactions, clear sessions/locks, retain committed logical rows |
| Queue | Abort commands; logical messages retained; lease/retention timers continue |
| Object storage | Abort commands; retain logical current objects; physical durability Unknown |
| DNS authority / resolver | Retain authored records / clear resolver answers; abort owned commands |
| CDN | Purge actual objects, refuse stale fills, abort commands; origin fetches refill later |
| Registry | Abort operations; retain logical graph/blobs; failed startup needs a later permitted retry |
| Monitoring | Abort work; bounded retained buffer, stale/missing samples and unconfirmed exports remain explicit |
| Firewall / LB | Process crash unavailable; their actual process restart semantics are incomplete |

CPU spike is M2C competitor demand on modeled compute only. Network delay names
actual materialized directed links. MemoryLeak and DiskFailure remain unavailable
for Model 2; there is no percentage adjustment or generic device failure shortcut.
Published Model-1 faults and evidence are unchanged.

## Presentation and shipping

The internal `infraforge-model2-presentation/1` contract supports Observed,
Interpreted and Unknown with units, evidence paths, timestamps and version context.
CPU ratios are interpretations of core-time intervals; raw queue/cache/session/DNS
and telemetry facts come directly from retained evidence. Cost and complete process
memory remain Unknown rather than zero. No normal UI consumes this contract yet.

The shipping inventory now separates infrastructure input/output/resource/workload/
fault/security/provider-cost categories from software UI actions and presentation.
`PRODUCT_UI_VALIDITY` requires reviewed software behavior proof.
`MODEL2_REALITY_SHIPPING_READY` requires real technical semantics/evidence.
Closing a dialog, selecting a prediction, searching or panning needs no physics
owner. Mixed technical fragments retain their technical claim. New fingerprints
are UNREVIEWED and fail closed; reclassification cannot prove a button works.
Counts are scanned AST surfaces, including nested fragments, not unique controls.

All legacy technical controls remain blocked unless the actual final-product
binding is proven. An internal compile/run foundation does not activate Free Mode
or migrate challenge history. Provider/region/failure-domain/pricing contracts
belong to M2I. No production deployment is recommended.
