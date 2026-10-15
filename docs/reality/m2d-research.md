# M2D networking research and decisions

Researched 2026-10-15. Mechanism sources do not establish a provider/WAN performance
constant. M2B caller ownership and M2C compute/memory research remain applicable.

| Primary source | Design decision / boundary |
| --- | --- |
| [RFC 2330, measurement framework](https://www.rfc-editor.org/rfc/rfc2330.html), [RFC 2681, round-trip delay](https://www.rfc-editor.org/rfc/rfc2681.html) | Separate observations, metrics, uncertainty and applicability. Request and response may have different paths/queueing. Authored propagation is not RTT; loopback response timing cannot identify propagation independently of endpoint/runtime work. |
| [RFC 9110, HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2) | Ambiguous failure is not proof that an operation never executed. Retry metadata carries idempotency; unknown/non-idempotent operations need explicit application opt-in after delivery. This generic authored opt-in does not claim compliance with an HTTP proxy's stricter prohibition on automatic non-idempotent replay. |
| [RFC 9112, HTTP/1.1 persistence/pipelining](https://www.rfc-editor.org/rfc/rfc9112.html#section-9.3) | Persistent connections outlive requests. The serial mode deliberately has one active operation per connection and no pipelining; it is a scoped HTTP/1-like policy, not universal HTTP behavior. |
| [RFC 9113, HTTP/2](https://www.rfc-editor.org/rfc/rfc9113.html) | Stream concurrency and connection count differ. Multiplexed mode models configured logical stream slots without frames, flow-control windows, TCP head-of-line behavior or exact HTTP/2 performance. |
| [RFC 9000, QUIC](https://www.rfc-editor.org/rfc/rfc9000.html), [RFC 9114, HTTP/3](https://www.rfc-editor.org/rfc/rfc9114.html) | Independent streams and transport recovery require protocol state. Do not label generic multiplexing HTTP/3 or implement guessed cross-stream packet-loss effects. |
| [RFC 6298, TCP retransmission timer](https://www.rfc-editor.org/rfc/rfc6298.html) | Retransmission timing depends on transport measurements/state. M2D has no loss probability, congestion window, RTO estimator or retransmission counter. A partition is a deliberate message blackhole, not sampled packet loss. |
| Envoy [connection pools](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/connection_pooling) | Build resource-neutral lease/pool ownership with connecting, ready, active/idle, draining and closed states. Mode controls stream concurrency; reuse and idle expiry are explicit. HTTP, database and cache policies can later compose the same primitive. No Envoy default limit is copied. |
| Envoy [health checking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/health_checking) | Probes have cadence, timeout and consecutive thresholds. Observed eligibility can lag endpoint state. The M2D probe is an actual authored operation through the same path/pool/compute/dependency chain, so it consumes resources and can fail under load. It does not read CPU percentages or instant backend truth. |
| Envoy [load-balancer policies](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancers) | Implement deterministic round robin and least outstanding requests. Raw connection counts are a poor load proxy when stream concurrency differs. Least outstanding is explicitly named; it is not Envoy's randomized power-of-two policy. Weighted/locality/affinity schemes remain deferred. |
| Envoy [circuit breaking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking) | Implement real limits on connections, pending acquisitions, LB outstanding/pending work and concurrent retries. Distinguish them from compute queues. No failure-percentage adaptive state machine is invented. |
| Envoy [draining](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/draining), [outlier detection](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier) | Membership draining stops new selection, permits active leases through authored grace and then closes survivors. Passive failures remain evidence; advanced ejection/recovery/half-open breakers need their own configured policies. |
| Envoy [routing/retry ownership](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/http_routing) and AWS [timeouts, retries, backoff and jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) | Keep caller, pool acquisition, connection establishment, upstream response, health and LB pending deadlines distinct. Retry actual attempts with bounded explicit policy; backoff/jitter cannot make unlimited retries safe. Use keyed randomness and a concurrent retry bound. |
| Node [net](https://nodejs.org/api/net.html), [timers](https://nodejs.org/api/timers.html) | A socket connect event includes runtime scheduling; it is not pure propagation. Timer callbacks do not promise exact dispatch time. The controlled application pacer therefore measures an execution pipeline, not physical bandwidth. Host metadata records Node 24.15.0; current documentation is conceptual support, not a claim that a newer runtime was measured. |

## Layer and alternatives

M2D chooses whole-message FIFO store-and-forward serialization with an explicit
directed capacity and separate propagation. A message occupies one serializer until
its bytes are consumed; later messages wait. Propagation can overlap the next message.
This is a logical bottleneck/shaper abstraction, not a packet switch or TCP model.
Different paths can name the same link to share its capacity; two directions need
separate authored links for full duplex. An architecture edge does not create a
dedicated physical link automatically.

Fluid transfer sharing was considered: two 100-byte simultaneous transfers on a
one-byte/us bottleneck would finish near 200/200 us, while FIFO gives 100/200 us before
propagation. Neither is universally physical. FIFO makes the chosen message queue
discipline explicit and gives a simple calibratable application-pacer comparator.
Permanent bandwidth per connection would waste spare capacity; RPS division cannot
represent payloads; individual packets would require unsupported congestion/loss
parameters and event growth. These alternatives were rejected for this milestone.

Connection establishment is an authored aggregate duration, not an inferred RTT or
a simulated SYN/TLS exchange. It reserves a connection and consumes virtual time;
handshake bytes are outside current link byte accounting. Pool control and link
admission are distinct. Unknown request/response bytes refuse executable transport;
historical M2B/M2C operations remain replayable without network byte declarations.

Partitions discard current messages and refuse new transfers without notifying the
operation of loss; the operation waits for its own timeout. Healing permits new work
without resurrecting old messages. Explicit connection reset has an immediate scoped
signal to its users. These are authored fault semantics, not predictions of OS TCP
recovery. Service endpoint suspension preserves local work/memory and pauses service;
it is not a guessed process kill/restart. Readiness failure gates new admission while
existing work continues. LB process crash/restart is outside the model.

## Calibration outcome

The paced loopback campaign disproves the ideal serializer as a complete predictor
of this host's networking/runtime pipeline, especially for tiny messages. No fixed
latency was added to absorb residuals. Conditional socket-duration observations are
retained only at discrete fitting points; physical bandwidth, propagation and runtime
dispatch attribution remain Unknown. Detailed measurements/errors are in
[calibration](m2d-calibration.md). No cloud, internet, ALB/NLB or Free Mode claim follows.

Service discovery, TCP flow/congestion control, keepalive probes, half-open detection,
TLS cost, NAT/ephemeral ports, cross-zone/region topology, packetization and protocol
overhead need later explicit mechanisms/calibration. Request/body framing and CPU
overheads must not silently become universal link capacity or a latency constant.
