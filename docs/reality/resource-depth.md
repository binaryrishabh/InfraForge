# Equal-depth resource target

The [machine-readable matrix](resource-depth.json) contains all eleven supported
types and twenty dimensions per resource: configuration, input/output traffic,
state, capacity, limits, CPU, memory, network, connections, storage/I/O, queuing,
scaling, failure modes, chaos, recovery, security, cost, dependencies and observable
metrics. Each row also records its current implementation, reality gap and target
Model-2 behavior. Coverage tests reject a missing resource/dimension.

Levels describe Model1: `partial` means some explicit behavior; `generic` means a
shared transformation; `synthetic` means an unsupported performance proxy;
`approximation` means a labelled estimate; `static` means non-executing validation;
`absent` means unmodeled. `not-applicable` is scoped to the current abstract service
identity, not a claim that the physical provider has no machines/disks. A self-hosted
variant requires a distinct configuration/composition before exposing those metrics.

| Resource | Most consequential gap | Model-2 acceptance direction |
| --- | --- | --- |
| DNS | HTTP flow stands in for resolution | Query/answer/TTL state, resolver role and actual resolution dependencies |
| CDN | No cached objects or origin miss work | Cacheable request/byte classes, TTL/eviction, origin/network work and priced transfer |
| Firewall | Presence does not enforce policy | Protocol/listener/reachability policy, denied work and state-table limits |
| Load Balancer | No actual pending requests or sockets | Routing, health detection, finite admission and connection policies |
| Virtual Machine | Application throughput inferred from vCPU | Host capability separated from measured application service demand and worker state |
| Container Registry | No image pulls/startup dependency | Artifact/layer bytes and pull work that can block readiness |
| Cache | Fixed hit ratio without contents | Explicit reuse, capacity, TTL/eviction and cold/warm state |
| Database | Global demand/VM-count connections | Query work, pool/server limits, CPU/I/O/memory and contention state |
| Object Storage | No objects, operations or durable bytes | Operation classes, stored inventory, quotas, transfer and service billing |
| Message Queue | No backlog | Producer/consumer/ack state, finite buffers, redelivery and DLQ |
| Monitoring Agent | Fixed utilization without collection work | Collection/export demands, target overhead, buffers, loss and reachability |

Comparable depth means appropriate behavior, not identical fields. Managed-service
internal CPU may be Unknown while a self-hosted process has measured CPU demand.
No family gains more icons before these existing resources have honest depth.
The original dimensions above remain the historical Model-1 audit. Each JSON row
now has a separate `model2` record with all twenty dimensions, implemented/partial/
Unknown lists, mechanism/proof sources and remaining gaps. M2B–M2F deepen compute,
transport/LB, DB/cache and queue/objects; M2G adds DNS, CDN, stateful policy/TLS,
registry startup and real metric collection/export. Every current resource now has
a meaningful internal foundation, while physical demand/durability, protocol breadth
and visible-control migration remain partial/Unknown. No row claims final-product
eligibility. [Shipping inventory](shipping-reality.json) keeps the gate closed.

M2H adds a separate `productBridge` record for every row: owner, compiler,
required inputs, actual compile/run proof, scoped Unknown and final eligibility.
All eleven types have the `product-semantic-bridge-proven` level only because the
saved-domain proof executes their mechanisms. These authored profiles are internal;
no row becomes generally shippable. VM/LB scaling remains partial at provider level,
while the generic desired/provision/image/readiness/drain controller is now proven.
Legacy fields, provider pricing/location, physical memory/storage and unsupported
faults remain explicit gaps. See [M2H](m2h-product-bridge.md).
