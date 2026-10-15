# M2G validation and shipping boundaries

Focused tests cover full earlier async composition, real DNS cache/expiry/changed
destination, negative versus unavailable answers, retained pooled sessions, CDN
warm/expired/pending/recovery behavior, coalescing and stale-fill purge, actual DB
firewall denial, no listener, derived exposure, TLS identity/trust/validity, new versus
established policy flows, registry layer reuse/readiness/outage, compute-fault and
artifact-readiness composition, collection gaps, bounded export loss and ambiguous
ACK dedup. Three thousand deterministic cases vary DNS, CDN, security/TLS, registry,
monitoring, outages and timing; intermediate and horizon invariants reconcile owned
state. Every hundredth case repeats with different advance boundaries. Observations
and returned snapshots do not alter ownership. All earlier regressions remain required.

`m2g-proofs.json` retains 23 cross-resource snapshots. An outage cut and later result
are separate evidence, not a health label. Queue ready/leased/DLQ/ACK populations,
actual cache fallback work, running/blocked replicas and historical telemetry gaps
remain visible. A failed request can stay pending or terminal after a fault ends.

## Conservation

DNS fills reconcile with cache entries, replacement, eviction and expiry. CDN bytes
equal current objects, with fills partitioned by replacement/eviction/expiry/purge.
Physical connection attempts reconcile into admitted, failed, cancelled and pending;
admitted flows reconcile into active and closed ownership. TLS attempted decisions
reconcile into established and failed. Registry blobs are unique by digest, manifests
reference owned matching descriptors and tags reference manifests. Running replicas
retain the selected digest and require acquired cached layers. Agent-generated
observations partition into buffered, in-flight, confirmed exported and locally
discarded ownership, with actual bytes. Backend arrivals/dedup and latest ages are
independent, including unconfirmed export ambiguity. Existing caller, station, queue,
object and CPU invariants also remain enforced.

## Executor performance

`perf:systems` records setup, execution, evidence snapshot and serialization separately,
with source/engine/input hashes and explicit completion. Seven cases retain 5,000
DNS cache entries, 5,000 CDN objects (1,280,000 bytes), 10,000 rules and 1,000 caller
connections, a separate burst with admission failures, a 1,024-blob/256-manifest/tag
graph, 100 instrumented telemetry streams and a long dependency recovery horizon.
No giant logical body buffers are allocated in simulation.

Sparse sampling changes evidence volume, not execution. Heap samples include prior
cases/GC. Full configuration/state copies can dominate large evidence snapshots;
these costs remain reported. Ordered rule evaluation is linear per new flow and
retains its rule-examination count. This is executor performance under local load,
not service throughput, physical memory or calibrated infrastructure capacity.
Every rejected/deadline/in-flight/remaining-backlog outcome remains part of the result.
An initial performance input used an invalid zero periodic interval and was refused;
the explicit burst interval was corrected without changing engine limits.

## Coverage versus shipping

`check:shipping` and tooling validate coverage of every current infrastructure schema
field, resource, chaos option, scanned interactive control and technical display.
New fingerprints/default entries become UNKNOWN/ineligible. `check:model2-shipping`
separately refuses the current state: 441 surfaces, 62 REAL product metadata/UI
actions, 26 PARTIAL, 349 MODEL1_ONLY and four REMOVE_BEFORE_MODEL2_SHIP. All 379
blocked identities, descriptions, current meaning, owner, effects/provenance and
replacement/removal plan are in `shipping-reality.json` (`--blocked` prints them).

Known blockers include the legacy public/encryption/openPorts bridge; generic
size/region fields; SKU capacity/cost assumptions; autoscaling/manual resize/pool
controllers; all universal chaos mappings, especially synthetic memory/disk options;
Model-1 workload/global multipliers and technical metrics/security/cost displays.
Internal M2G mechanisms do not automatically make those existing UI controls real.
No unfinished migration fails the active Model-1 product merely for being unfinished.

Final acceptance requires one complete appropriate validation: frozen install,
typecheck/lint/boundaries, workspace and prior Model-2 tests, tooling/reality/depth/
calibration replay, 30 unchanged goldens, ten immutable challenge hashes, web build,
audit, isolated integration, exact-SHA Actions and external status inspection.
Actual commit/run/job results belong in the completion report; Vercel is separate.
