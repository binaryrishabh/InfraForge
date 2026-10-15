# M2F verification and executor measurements

Focused tests cover full compute/network/broker/object/DB flow, real backlog/age,
consumer crash and drain, delayed/lost acknowledgement duplicates, conditional
object idempotency, poison attempts/DLQ, atomic PUT visibility, conditional races,
generation/DELETE/capacity behavior, publish dedup, lease receipt identity, credit,
large body transport, broker pause, delayed expiry, DLQ overflow, lost publisher
confirmation, object read outage/recovery, sample/order/advance independence and
Unknown refusal. All earlier Model-2 regressions remain separate and unchanged.
Availability reassertion preserves in-flight work; conditional-effect collisions
verify content/size through real HEAD rather than silently accepting unrelated data.

## Committed proofs

| Proof | Mechanism evidence |
| --- | --- |
| Normal vertical | 12 uploads/publishes, 12 worker effects, 12 DB commits, 12 ACKs, 24 objects |
| Backlog/recovery | 24 ready at the outage cut; later 24 ACKs with four real redeliveries |
| Poison | One message fails three actual processing attempts and enters DLQ; three later messages ACK |
| Late ACK | One message has three deliveries, three side effects and eventually DLQ |
| Conditional object effect | Same deliveries, one mutation and two conditional suppressions; no exactly-once claim |
| Effect/ACK crash window | Effect completes before crash; lease expires; second delivery repeats the effect; final ACK succeeds |
| Object outage | Eight messages ultimately ACK; 24 failed processing attempts create actual redeliveries |
| Lost confirmation | Caller rejects while broker accepts/processes two messages; publish dedup retains one |
| Object size | 1 KiB vs 64 KiB causes real additional upload/download transport; larger case can exceed caller deadline while remote processing completes |

Direct object tests interleave PUT and GET to prove complete old/new visibility,
including a 100 MiB logical replacement with no 100 MiB JS buffer. Separate lease,
retention, capacity and stale-receipt tests exercise exact state boundaries.

## Large sweep and invariants

3,000 deterministic cases vary publish interval, message/object/result bytes,
consumer count/concurrency/prefetch, CPU, ack delay, lease, attempt limit, queue
count/byte limits, DLQ, dedup/idempotency, retention, object capacity, deadlines,
consumer/broker/object availability and fault timing. Checks run during execution
and at horizon; every hundredth case repeats with different advance boundaries.
Synthetic sweep success is not calibration. Earlier M2C/M2D/M2E sweeps remain required.

Accepted messages reconcile into ready + scheduled + in-flight + ACKed + DLQ +
expired + discarded. DLQ and live byte totals reconcile against actual message
bodies. Current receipts exactly partition consumer outstanding state and respect
credit. Message count and delivery count remain distinct. Stored object bytes
equal the current namespace/key inventory; replacement and deletion release actual
bytes. Worker local/active work respects prefetch/concurrency and CPU work stays
within available core-time. Existing caller/station conservation remains enforced.

Snapshots do not expire messages, commit objects or run service. Config, event and
state evidence is copied by the public internal runner. Failed execution budgets
remain explicit incomplete runs rather than partial evidence claimed as complete.

## Executor performance

`perf:async` measures five 1,000-offered-caller cases: held-consumer backlog,
16 consumers, lease expiry/DLQ, 100,000 final objects, and 100 MiB logical values.
The lease case makes 3,000 real deliveries and moves 1,000 messages to DLQ. Large
inventory begins at 98,000 keys to leave space for producer/result objects. Large
values are metadata, with authored logical network buffers rather than payload
allocation. All acceptance/rejection and horizon populations remain visible.

Initial excessive polling exhausted the finite event budget in the performance
experiment. The experiment now authors a 1 ms polling interval rather than raising
or hiding that budget. Sampling is sparse in these executor measurements; this
changes evidence volume, not resource physics. The final JSON retains setup,
execution, snapshot/serialization timings, event/heap populations and all outcomes.
Heap samples include prior cases/GC and are not per-resource resident estimates.
No broker/storage performance claim follows from local executor speed.

| Final local case | Execute | Evidence snapshot | Serialize |
| --- | ---: | ---: | ---: |
| Backlog | 1,088.72 ms | 53.70 ms | 8.93 ms |
| 16 consumers | 2,547.33 ms | 76.19 ms | 12.01 ms |
| Lease expiry/DLQ | 2,180.61 ms | 115.40 ms | 20.38 ms |
| 100,000 objects | 1,369.90 ms | 672.04 ms | 114.34 ms |
| 100 MiB logical values | 674.38 ms | 17.29 ms | 3.43 ms |

The large-value case admits 120 of 1,000 offered callers and retains 12,582,919,680
logical object bytes; input/application/network admission outcomes remain visible.
Large-state setup is 546.67 ms. These are one local sample under variable load.

Final acceptance includes frozen install, workspace typechecks/lint/tests, boundaries,
all Model-2/reality/calibration/tooling replay, 30 unchanged Model-1 goldens and ten
immutable challenge hashes, web build, audit, appropriate disposable integration,
exact-SHA Actions and separate external status inspection. Actual SHA/job counts
belong in the completion report; this document does not predict CI completion.
