# Internal distributed data path: m2d/1

The internal registry defaults to M2D; explicit `m2c/1`, explicit `m2b/1` and direct
M2A replay remain. Model 1 remains the only active published model. Nested network
modules are excluded from runtime packaging and browser import closures. No schema,
HTTP/UI selector, challenge migration or provider mapping is added.

## Composition

```
caller -> entry path/pool -> load balancer -> selected backend path/pool
       -> compute worker -> dependency path/pool -> downstream service
       <- response paths unwind through each owner
```

`network/run` composes links, pools, transport and LB modules with the existing
compute/workload runtime. The shared seam supports entry transport, resource-specific
receive/routing and dependency sends. M2C retains CPU scheduling, application queues,
blocking waits and resident ownership. The existing database station is only the old
dependency proof; DB connections/query/locks/cache physics are not deepened.

Every caller-entry, LB-backend and service-dependency pair needs an explicit path.
Each path has directed request and response link sequences, operation-specific known
request/response bytes, and a pool policy. Path hops must join continuously. Several
paths may share an authored link; separate directions can have different capacity
and propagation. Trace `payloadBytes` remains application payload metadata; path byte
declarations describe the modeled transmitted message. No payload is inferred as zero.

## Links and bytes

`fifo-message/1` has one active whole-message serializer, a FIFO waiting buffer and
independent propagating transfers. Service is `bytes / (bytes/s)` converted to us.
Completion rounds up to integer us; byte service does not round the message size up.
The queue byte limit excludes the active serializer and propagating messages. A full
queue rejects at this layer, separately from pool, LB and compute queues.

Before bandwidth/partition/cancellation changes, settle actual consumed bytes at the
event time; replace the one serializer boundary. Observation projects partial service
without changing physics. A zero-bandwidth intervention stalls serialization until
capacity returns; there are no per-byte events. Propagation starts after complete
serialization. Added delay is captured at propagation admission; messages already
propagating retain their scheduled delay. Multi-hop transport is store-and-forward.
This chosen discipline is not TCP fairness or packet-switch performance.

Byte counters separately track offered, accepted/rejected, transmitted, delivered,
failed message bytes, discarded transmitted bytes and live message/sent bytes:

```
offered = accepted + rejected
accepted = delivered + failed + live original bytes
transmitted = delivered + discarded transmitted + live transmitted bytes
```

They count modeled message bytes per traversed link. Summing links counts hop-bytes,
not unique payload or billable transfer. Headers, retransmission and handshake traffic
are not added without an explicit future mechanism.

## Pools and protocol policies

A reusable pool owns connecting, ready idle, ready active and draining connections;
closed objects are removed while cumulative counters remain. Each connection can
lease configured stream slots. Serial mode requires one slot; multiplexed mode allows
several logical operations, without HTTP/2/3 frames/windows or packet internals.
Non-reuse mode requires one stream and closes the connection after its invocation.

Pending acquisition includes connection-creation reservations and unassigned waiting
requests. The configured pending limit rejects additional unreservable acquisitions;
an immediately reservable ready/connecting/new slot can still be admitted. Connecting
reservations therefore contribute to waiting evidence without being a separate
unbounded queue. Successful activation cancels the acquisition deadline and any idle
expiry. Last release can retain an idle connection, start authored idle expiry or
close a non-reusable/draining connection. Pools do not assume idle timeouts.

Connection creation has an authored establishment duration and independent timeout.
If the path/target cannot establish at its readiness event, it remains connecting
until timeout. No immediate partition detection is invented. The model does not
restart a stalled handshake after healing. A reset closes existing connections and
fails their active users/reservations. New unassigned work may establish fresh ones.
A per-stream cancellation releases its lease and does not reset unrelated streams.
Pool connection and stream identities remain separate from request identity.

## Load balancing, health and readiness

The LB is a resource with backend membership, observed health, draining state,
outstanding/pending request bounds and path pools. Round robin traverses canonical
backend identities; least-outstanding chooses eligible minimum outstanding requests
with lexical ties. Neither uses instantaneous CPU or RPS splitting. Source/resource
array order does not define policy. New selection requires observed eligible health
and no draining flag. A selected backend's pool may still queue/fail.

Endpoint existence/service availability and readiness are explicit authored booleans.
Ready=false rejects new delivery while existing invocations can finish. Alive=false
on compute/legacy DB suspends local service and suppresses delivery; ownership is
retained, then resumed on restoration. This is suspension/unavailability, not process
death/OOM/restart. Independent overlapping pause policies are refused. LB process
suspension is unmodeled; its readiness gate is available.

Health checks issue the selected operation through real backend paths, connection
pools, bytes, compute and dependencies. Consecutive pass/fail thresholds change
observed eligibility after the result/timeout. Initial eligibility is explicit; no
instant truth read occurs. Probes consume capacity and can time out under overload.
Cadence/timeout are authored, overlap is refused and total probe count is guarded.
Passive failure reasons are retained without automatically ejecting a backend.

Draining immediately stops new LB selection, rejects pending acquisitions for that
backend and closes idle/connecting connections. Existing active leases may complete
until grace ends; survivors fail `drained`. Membership remains visible. It is not node
deletion. Other paths to the same physical service are independent owners. No endpoint
re-addition/deployment lifecycle is invented.

## Timeout and retry ownership

- Caller timeout/abandonment remains M2B-owned and does not prove remote cancellation.
- Acquisition timeout covers waiting for a lease, including connection establishment.
- Connect timeout belongs to a connecting connection and fails its reservations.
- Response timeout starts at lease activation and covers request transport, remote
  queue/service/dependencies and response transport.
- LB pending timeout covers waiting for an outstanding-request slot.
- Health timeout belongs to a probe observation and requests cancellation of that probe.

Transport completion/timeout is independent of remote execution. Each path explicitly
chooses detachment or requesting remote cancellation; unsupported remote cancellation
still leaves work running. Reset/response-timeout can fail all users of the affected
connection. The first terminal owner result wins; late remote outcomes remain evidence.
No HTTP status such as 502 is invented from a resource label.

Optional LB retry policy supplies max attempts, retryable path failures, concurrent
retry budget, exponential base backoff, jitter ratio and explicit ambiguous-operation
opt-in. No policy means no retry. Before delivery, failures are unambiguous in this
whole-message model; after delivery, only read-only/idempotent work or explicit authored
permission can retry. This generic policy is not an HTTP-compliance claim. No-backend
and LB pending failures are terminal at this LB and are not accepted retry reasons.

Every retry has stable root/parent identity, a distinct attempt/call ID, selected backend
and reason. It reacquires a pool lease and traverses bytes/compute/dependencies as real
work. Backoff uses `ceil(base * 2^(attempt-1) * (1 + jitter*(2*keyedDraw-1)))`; the draw
is keyed by seed, LB, prior attempt call and purpose. Concurrent retry overflow stops
that retry; global event/request budgets still bound execution. Retries cannot create
a CPU multiplier or undo ambiguous work.

## Faults, evidence and extension

Partition blackholes currently live messages and refuses new transfers silently;
only owning timeouts detect the missing result. Healing permits new transfers without
reviving discarded messages. Bandwidth and added delay change their actual link
mechanisms. Explicit path resets fail actual connection users. No packet loss, RTO,
congestion window or RTT counter is emitted.

Evidence contains link service/byte/queue populations, path outcomes/timeout reasons,
pool creations/reuses/connections/streams/pending, LB selections/health/draining/retries,
bounded phase events and complete event-type totals with omissions. Duration totals
are sums of completed phase observations, not a universal per-root waterfall; phase
events and caller outcomes supply individual causality. Health roots are separately
identified and never counted as workload caller roots.

Inputs and returned evidence are copied. Observations cannot alter service, remaining
bytes, quotas, connection ownership or timers. Canonical identities and explicit tie
priorities preserve replay. Pool leases can support later DB/cache resource policies
without importing HTTP wire semantics. Physical/provider transport, DNS, NAT, protocol
recovery, TLS, deep database/cache behavior and cost remain unmodeled/Unknown.
