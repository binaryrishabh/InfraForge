# M2F messaging and object architecture

M2F is selected explicitly as internal `m2f/1`. Model 1 remains active; the internal
default stays M2D for compatibility. No public runtime export, route, challenge
migration, UI change, schema change or provider SKU mapping is added.

## Modules and composition

`async/contracts.ts` defines separate queue, object, publisher and worker resources.
`commands.ts` is a bounded command admission/CPU/timeout helper, not shared resource
physics. `broker.ts` and `objects.ts` own their distinct state machines. `publisher.ts`
and `worker.ts` implement authored application orchestration. `run.ts` composes
them through the M2E resource factory and M2D transport; workers use M2C scheduling
directly. Normal producer compute and optional relational writes use existing
compute/data resources. `validate.ts` preserves pre-copy budgets and exact ledger
provenance. All new execution is excluded from the normal browser/runtime image.

| Ownership | State |
| --- | --- |
| Caller | M2B root, offered time/deadline and detached downstream outcome |
| Publisher | Object upload followed by bounded publish attempts; no transactional outbox |
| Broker message | Logical ID, publish attempt, unique accepted instance, body/size, acceptance/retention time |
| Ready/scheduled | Eligibility order or an owned initial-delay timer |
| Delivery | Consumer ID, attempt number, receipt, delivery time, lease deadline |
| Consumer | Broker credit, local prefetch, buffered/active/ack-wait work and crash epoch |
| Object operation | Admission, CPU/wait, timeout, atomic commit/read point, response |
| Object | Namespace/key, current generation, logical bytes, opaque content identity |
| Network | Actual connection leases, request/response envelopes plus logical body bytes |

## Queue contract

`visibility-work-queue/1` is pull-based and does not claim RabbitMQ/SQS/Kafka
equivalence. Live count/bytes include ready, scheduled and leased messages. At
capacity, publish rejects. Command concurrency/pending bounds can independently
queue or reject operations. Confirmation means logical acceptance, not physical
durability. Optional run-long bounded logical-ID dedup refuses body conflicts.
Message byte capacity counts modeled body bytes; broker metadata, allocator and
replica overhead remain Unknown rather than being silently included.

Ready delivery uses insertion order. Requeue appends to the current tail. Consumer
credit caps live receipts independently of processing concurrency. Lease and
retention use integer virtual time and expiry wins at exact ack ties. ACK requires
the current receipt and consumer and terminates that instance. NACK explicitly
requeues/discards/dead-letters. Exceeding max attempts moves the actual message to
the bounded DLQ; DLQ overflow discards visibly. Retention terminates actual live
ownership and may precede completion of already dispatched external work.

Message ID differs from publish and delivery attempt identity. Without dedup, a
publisher retry can create two broker instances of one logical ID. Repeated delivery
uses the same accepted instance and a new receipt/processing attempt. No global
processing FIFO or exactly-once guarantee is asserted.

Broker process pause rejects/aborts commands and preserves accepted logical state.
Lease/retention clocks continue while paused. Consumer crash cancels local work,
clears local ownership and invalidates callbacks by epoch; remote requests already
delivered can continue. Lost receipts recover only by lease policy. Recovery polls
and drains backlog at actual authored capacity; no instant recovered-state label.

## Pipeline contract

Producer compute → upload object → publish → caller response. Workers poll through
real broker paths, GET the input object, consume CPU/blocking demand, PUT a result,
optionally update a relational key, then ACK. Every operation consumes actual
request/response bytes, pools and service. Parent-local child identity avoids shared
mutable sequence coupling. Poll interval is authored and empty polls still consume
real work; one recurring timer per worker is bounded by horizon/event budget.

Poison keys NACK and requeue until the configured attempt limit. Side-effect/ack
delay or crash can cause repeated processing. `object-if-absent` uses an atomic
result-key conditional PUT, not a simulated dedup percentage. It prevents repeated
object mutation while duplicate GET/CPU/conditional-write attempts still occur.
A failed creation condition requires a real HEAD confirming expected logical content
and size; an unrelated existing object is not accepted as processed.
Combining this policy with DB side effects is refused: no cross-resource atomicity
exists. Without this option, both object replacement and DB updates may repeat.
Worker metrics count locally observed responses; an effect committed remotely
after worker loss can appear only in store/DB evidence, as it should.

Upload and publish are not atomic. Broker rejection can leave an uploaded object.
A lost upload response can leave an object without a published message. Worker
GET reads the current input object; immutable-version binding is a future protocol.
Caller completion does not wait for asynchronous processing or DLQ outcome.

## Object contract

`atomic-current-object/1` supports PUT, GET, HEAD and DELETE. All operations linearize
when command CPU/wait finishes. PUT checks conditions/capacity at that instant,
then atomically replaces or creates the complete logical object. GET copies one
complete current metadata version. Generation tokens are monotonically allocated
and not reused after deletion; they are not hashes. Conditional creation and
generation comparison are supported; old versions are not retained. DELETE removes
the addressed key and its bytes, not an anonymous byte counter.

Capacity is optional and logical. Existing objects survive temporary service/read/
write unavailability and capacity reduction. A reduced limit may temporarily be
below retained state; future writes are checked rather than deleting old objects.
Pending command timeout/cancellation aborts before commit; once committed, a lost
response does not roll it back. Physical device latency, persistence, replica bytes,
checksums, billing, lifecycle, object locks and recovery guarantees are Unknown.

The internal message envelope can carry request/response logical body byte counts.
M2D adds them to authored framing envelopes. PUT body size comes from authored
object size; GET body size comes from the selected actual object version. HEAD,
DELETE and failed GET do not transfer object bodies. No giant JS payload buffer is
allocated by the simulator. Byte fields are safe-integer checked and use the same
network serialization/queues as other traffic.

## Evidence and extension seams

Broker evidence partitions accepted ownership, delivered attempts, redelivery,
expiry/discard/DLQ, byte state, consumer credit and oldest ready age. Worker evidence
exposes buffering/CPU/effects/acks/crash losses and bounded lineage events. Publisher
evidence separates uploads, attempts, confirmations, failures and conservative
ambiguity. Store evidence exposes current keys/generations/bytes, operation counts,
in-flight command kinds, capacity/access and generated response body bytes. Existing
network evidence shows bytes actually accepted/transmitted/delivered.

Counts and pure copied snapshots are authoritative; omitted event rows are marked.
Full message/object inventories are bounded but can be expensive. Generic compute
worker/memory fields are adapter envelopes and do not claim data-process resident
memory. Process memory remains partial/Unknown. Policy limits and proof inputs have
explicit ledger metadata and are forbidden from Free Mode.

Later multipart ownership can feed the same atomic commit; registry manifests/tags
can reference blob identities without changing the store into a registry. Future
partitioned logs need their own offset/retention/group state rather than queue ACK
deletion. LIST, multipart, stream offsets, fan-out, batch delivery, lease renewal,
physical replication/durability and cross-resource transactions remain deferred.
