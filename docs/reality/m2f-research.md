# M2F research and profile decisions

Researched 2026-10-15 using primary documentation. These are InfraForge's authored
internal profiles, not product emulators. Local versions and measured protocol
boundaries live in the campaign artifacts. No provider resource is accessed.

## Different messaging resources need different ownership

A delivery work queue transfers responsibility to a processing attempt and releases
stored work after acknowledgement. A visibility queue hides a message for a lease
and can expose it again while the original processing continues. A partitioned log
retains ordered records independently of consumer offsets; consumer groups assign
partition progress rather than deleting a record per acknowledgement. Collapsing
these into one queue would erase different recovery and replay contracts.
[Kafka design](https://kafka.apache.org/41/design/design/),
[SQS visibility](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html).

M2F selects **visibility-work-queue/1**, an explicit pull/lease profile. Logical
message identity, publisher attempt, broker-owned instance, delivery receipt and
consumer processing attempt remain separate. The profile is not named SQS,
RabbitMQ or Kafka. Later streams should own partitions, append offsets, retention
and consumer-group progress in a separate resource module, reusing message/transport
identity without inheriting queue deletion semantics.

## Publish and consume are separate acknowledgement domains

Publisher confirmation indicates broker responsibility under the configured
confirmation contract; it does not mean a consumer has processed the message.
Consumer acknowledgement releases broker ownership after processing. Bytes sent
on a socket establish neither. Lost confirmation can make a publisher retry work
already accepted, so deduplication/idempotency must be explicit application choices.
[RabbitMQ confirms](https://www.rabbitmq.com/docs/confirms).

M2F's publish response means only **logical broker ownership**. No disk persistence,
replication quorum or durable publisher-confirm path is inferred. Caller success
means upload/publish completed, not asynchronous processing completed. Failed
confirmation transport is conservatively unconfirmed/possibly ambiguous; broker
evidence separately records whether acceptance actually happened. Bounded immediate
publisher retries have new attempt identities. Optional publish dedup remembers
logical identity and body within a bounded run-long index and refuses conflicting
reuse. This is not a provider's timed dedup window.

## Leases, credit and real repeated work

Credit bounds unacknowledged broker deliveries owned by a consumer; worker count
and local processing concurrency are different populations. Lease expiry releases
broker credit and returns a message to eligibility, even if processing or a response
is still in flight. An old receipt must not acknowledge a newer attempt. Processing
completion can happen out of delivery order. Requeue appends to current ready order;
concurrent clients, delays and redelivery preclude global processing FIFO.
[RabbitMQ consumers](https://www.rabbitmq.com/docs/consumers),
[queue ordering](https://www.rabbitmq.com/docs/queues).

The worker has an explicit polling interval, prefetch bound, concurrency, CPU work,
blocking wait and acknowledgement delay. These are authored workload/configuration,
not universal broker or storage facts. Polling uses real network requests. Crash
clears local ownership and cancels local CPU/timers, while already delivered remote
work may continue. The broker's existing leases then govern redelivery. Logical
broker pause retains message state and rejects commands; virtual retention/lease
deadlines continue. This is not a physical restart/persistence claim.

## Retry, DLQ and delivery guarantees

Acknowledgement removes the real message. Negative acknowledgement explicitly
requeues, discards or dead-letters it. A finite delivery-attempt ceiling prevents
poison work retrying indefinitely. DLQ capacity is separate from the live queue;
overflow is a visible discard terminal state. Retention expires real messages,
including leased work, but does not undo an already completed external effect.
TTL and dead-letter rules vary across brokers; M2F declares its own exact policy.
[RabbitMQ dead lettering](https://www.rabbitmq.com/docs/dlx),
[expiry](https://www.rabbitmq.com/docs/ttl).

This is a bounded redelivery profile, not an unconditional eventual-processing
guarantee: retention, capacity, DLQ, unavailable consumers and finite horizon matter.
At-most-once delete-on-delivery was considered but deferred because it cannot
support the required post-effect/pre-ack failure proof. Exactly-once processing
is not claimed. Fan-out, routing exchanges, batches, message groups, delayed
retries beyond initial delay, lease renewal and consumer connection-affine ack
protocols are future profiles, not silently simulated features.

The side effect can commit before acknowledgement is recorded. A later attempt
therefore performs real extra GET/CPU/PUT work. Optional conditional result-object
creation prevents repeated mutation of that one object; it cannot atomically join
an external DB update, object write and queue ack. Cross-resource idempotency needs
transactions/outbox/inbox or a stronger application protocol. M2F refuses the
conditional-object option combined with an external DB side effect, rather than
claiming those effects are atomic.
[RabbitMQ reliability](https://www.rabbitmq.com/docs/reliability).

## Object operations, namespace and consistency

Object stores address whole values by namespace/key; they are not seekable block
devices or filesystems. A generic current-object profile is sufficient: PUT,
GET, HEAD and DELETE with atomic per-key visibility and monotonically allocated
generation tokens. A GET linearizes when its command executes and returns a
complete copied metadata version; replacement during response transport cannot
change that selected version. Conditional writes/read generation checks operate
at the same commit point. Tokens are not checksums or content hashes.
[S3 consistency concepts](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel),
[conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

These documents demonstrate useful semantics, not universal cloud behavior or
numeric performance. M2F's **atomic-current-object/1** is InfraForge's own profile.
It retains only current versions, releases replaced/deleted bytes and has no
version archive. Logical capacity, if authored, excludes unknown replica/allocator
overhead. Reduced capacity may leave existing state over limit; new PUTs are checked
at commit and DELETE can free state. Temporary service/read/write outage preserves
committed objects. Failed or timed-out operations are not magically retried.

CPU and application-specific blocking demand remain explicit command profiles.
No universal GET/PUT latency, IOPS, bandwidth, storage-class speed or durability
percentage is inferred. Object payload size adds actual bytes to M2D request/response
serialization separately from command service. The simulator stores size and an
opaque logical content label, never giant payload buffers. Network framing bytes
are still authored protocol envelopes, not an exact HTTP/RESP serializer.

LIST is deferred because snapshot/pagination ordering needs its own contract.
Multipart is deferred because parts, upload IDs, retries, orphan ownership,
completion and abort cleanup require separate state. A future multipart module
can commit through the same atomic object boundary; size alone must never imply
a multipart speed benefit. Range reads, checksums, retention/object locks,
version archives, storage classes, replication, lifecycle and notifications are
also explicit Unknowns/deferred mechanisms.
[Multipart lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html).

A future registry can reuse namespace/key/generation, logical content/blob identity,
sizes, conditional atomic writes and byte transport. Manifest references, tag
updates, digest validation, blob reachability/GC, pull authorization and cache
policy belong in that registry resource, not in the object store.

## Real campaign and alternatives

The broker campaign uses RabbitMQ's HTTP management publish/get endpoints, which
support explicit requeue/ack actions. The official reference describes these
endpoints as management/testing tools, not a normal messaging workload protocol.
The campaign verifies populations and real redelivery identity; it does not
validate AMQP prefetch, visibility semantics or production throughput. This narrow
boundary is preferable to labelling unrelated protocol costs as calibrated queue
CPU. [HTTP API](https://www.rabbitmq.com/docs/http-api-reference).

An independently written local Node HTTP object reference provides bounded real
byte PUT/GET/HEAD/DELETE and conditional operations. It is neither S3 nor a physical
storage device. Persistent connection reuse is controlled with HTTP agents; client
and reference server share a process, so process CPU cannot isolate server demand.
Windows samples include zeros at this batch duration, confirming the measurement
limit rather than proving zero CPU cost.
[Node HTTP agents](https://nodejs.org/api/http.html#class-httpagent),
[CPU observation](https://nodejs.org/api/process.html#processcpuusagepreviousvalue).

Rejected shortcuts: queue/RPS multipliers, fixed-delay storage boxes, synthetic
queue-health percentages, automatic exactly-once, unlimited poison loops, physical
durability inferred from response success, full-product labels, implicit event
notifications and latency offsets. M2D/M2E rejected predictors remain rejected.
